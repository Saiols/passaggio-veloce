import 'server-only';
import { prisma, Prisma } from '@pv/db';
import { env } from '@/env';
import { getEmail } from '@/lib/providers/email';
import {
  tplN10AdminEscalation,
  tplN11BrokerEscalation,
  tplN1BrokerInvio,
  tplN2BrokerAccettata,
  tplN4BrokerFirma,
  tplN6AgenziaNuova,
  tplN8AgenziaAddebito,
  type N10AdminEscalationPayload,
  type N11BrokerEscalationPayload,
  type N1BrokerInvioPayload,
  type N2BrokerAccettataPayload,
  type N4BrokerFirmaPayload,
  type N6AgenziaNuovaPayload,
  type N8AgenziaAddebitoPayload,
  type NotificaContent,
} from './templates';

type Target = {
  email: string;
  userId?: string | null;
  companyId?: string | null;
};

type SendInput =
  | { tipo: 'N1_BROKER_INVIO_PRATICA'; target: Target; payload: N1BrokerInvioPayload }
  | { tipo: 'N2_BROKER_ACCETTATA'; target: Target; payload: N2BrokerAccettataPayload }
  | { tipo: 'N4_BROKER_FIRMA_E_CREDITO'; target: Target; payload: N4BrokerFirmaPayload }
  | { tipo: 'N6_AGENZIA_NUOVA_PRATICA'; target: Target; payload: N6AgenziaNuovaPayload }
  | { tipo: 'N8_AGENZIA_ADDEBITO'; target: Target; payload: N8AgenziaAddebitoPayload }
  | { tipo: 'N10_ADMIN_ESCALATION'; target: Target; payload: N10AdminEscalationPayload }
  | { tipo: 'N11_BROKER_ESCALATION'; target: Target; payload: N11BrokerEscalationPayload };

function render(input: SendInput): NotificaContent {
  switch (input.tipo) {
    case 'N1_BROKER_INVIO_PRATICA':
      return tplN1BrokerInvio(input.payload);
    case 'N2_BROKER_ACCETTATA':
      return tplN2BrokerAccettata(input.payload);
    case 'N4_BROKER_FIRMA_E_CREDITO':
      return tplN4BrokerFirma(input.payload);
    case 'N6_AGENZIA_NUOVA_PRATICA':
      return tplN6AgenziaNuova(input.payload);
    case 'N8_AGENZIA_ADDEBITO':
      return tplN8AgenziaAddebito(input.payload);
    case 'N10_ADMIN_ESCALATION':
      return tplN10AdminEscalation(input.payload);
    case 'N11_BROKER_ESCALATION':
      return tplN11BrokerEscalation(input.payload);
  }
}

/**
 * Invia una notifica via email provider + audit su NotificaInviata.
 * Fire-and-log: errori provider non bloccano il flusso chiamante, ma sono
 * registrati nella riga NotificaInviata (stato=FAILED + errorMessage).
 */
export async function sendNotification(input: SendInput): Promise<void> {
  const content = render(input);
  const payload: Prisma.InputJsonValue = JSON.parse(JSON.stringify(input.payload));

  const record = await prisma.notificaInviata.create({
    data: {
      tipo: input.tipo,
      canale: 'EMAIL',
      stato: 'SCHEDULED',
      userId: input.target.userId ?? null,
      companyId: input.target.companyId ?? null,
      destinazione: input.target.email,
      subject: content.subject,
      bodyPreview: content.text.slice(0, 200),
      payload,
    },
  });

  try {
    const email = getEmail();
    const result = await email.send({
      to: input.target.email,
      from: env.EMAIL_FROM,
      subject: content.subject,
      html: content.html,
      text: content.text,
      tag: input.tipo,
    });

    if (result.ok) {
      await prisma.notificaInviata.update({
        where: { id: record.id },
        data: {
          stato: 'SENT',
          sentAt: new Date(),
          providerRef: result.messageId,
        },
      });
    } else {
      await prisma.notificaInviata.update({
        where: { id: record.id },
        data: {
          stato: 'FAILED',
          failedAt: new Date(),
          errorMessage: result.error,
        },
      });
    }
  } catch (err) {
    await prisma.notificaInviata.update({
      where: { id: record.id },
      data: {
        stato: 'FAILED',
        failedAt: new Date(),
        errorMessage: (err as Error).message.slice(0, 500),
      },
    });
  }
}

/**
 * Invia N notifiche in parallelo (batch per assegnazioni round). Non
 * propaga errori di singole invii: ognuna è tracciata in NotificaInviata.
 */
export async function sendNotifications(inputs: readonly SendInput[]): Promise<void> {
  await Promise.all(inputs.map((i) => sendNotification(i).catch(() => undefined)));
}

/**
 * Recupera le email degli admin piattaforma attivi.
 * Usata da notifiche tipo N10 (escalation).
 */
export async function getAdminEmails(): Promise<{ email: string; userId: string }[]> {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN_PIATTAFORMA', status: 'ACTIVE', deletedAt: null },
    select: { id: true, email: true },
  });
  return admins.map((a) => ({ email: a.email, userId: a.id }));
}
