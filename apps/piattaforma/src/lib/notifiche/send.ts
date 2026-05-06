import 'server-only';
import { prisma, Prisma } from '@pv/db';
import { env } from '@/env';
import { getEmail } from '@/lib/providers/email';
import {
  tplN10AdminEscalation,
  tplN11BrokerEscalation,
  tplN12AffiliazioneCommissione,
  tplN13BrokerPraticaProcessata,
  tplN14AccountSospeso,
  tplN15AccountRiattivato,
  tplN16AccountEliminato,
  tplN17BrokerPenaleAddebitata,
  tplN18AgenziaSegnalazioneConfermata,
  tplN19AdminNuovaSegnalazione,
  tplN20AdminRevisioneRichiesta,
  tplN21BrokerRevisioneCompletata,
  tplN22ReferralSignup,
  tplN23ReferralFirstPratica,
  tplN24PayoutAffiliationAvailable,
  tplN25MonthlyAffiliationRecap,
  tplN1BrokerInvio,
  tplN2BrokerAccettata,
  tplN3BrokerSollecito,
  tplN4BrokerFirma,
  tplN6AgenziaNuova,
  tplN7AgenziaPromemoriaCountdown,
  tplN8AgenziaAddebito,
  type N10AdminEscalationPayload,
  type N11BrokerEscalationPayload,
  type N12AffiliazioneCommissionePayload,
  type N13BrokerPraticaProcessataPayload,
  type N14AccountSospesoPayload,
  type N15AccountRiattivatoPayload,
  type N16AccountEliminatoPayload,
  type N17BrokerPenaleAddebitataPayload,
  type N18AgenziaSegnalazioneConfermataPayload,
  type N19AdminNuovaSegnalazionePayload,
  type N20AdminRevisioneRichiestaPayload,
  type N21BrokerRevisioneCompletataPayload,
  type N22ReferralSignupPayload,
  type N23ReferralFirstPraticaPayload,
  type N24PayoutAffiliationAvailablePayload,
  type N25MonthlyAffiliationRecapPayload,
  type N1BrokerInvioPayload,
  type N2BrokerAccettataPayload,
  type N3BrokerSollecitoPayload,
  type N4BrokerFirmaPayload,
  type N6AgenziaNuovaPayload,
  type N7AgenziaPromemoriaCountdownPayload,
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
  | { tipo: 'N3_BROKER_SOLLECITO'; target: Target; payload: N3BrokerSollecitoPayload }
  | { tipo: 'N4_BROKER_FIRMA_E_CREDITO'; target: Target; payload: N4BrokerFirmaPayload }
  | { tipo: 'N6_AGENZIA_NUOVA_PRATICA'; target: Target; payload: N6AgenziaNuovaPayload }
  | { tipo: 'N7_AGENZIA_PROMEMORIA_COUNTDOWN'; target: Target; payload: N7AgenziaPromemoriaCountdownPayload }
  | { tipo: 'N8_AGENZIA_ADDEBITO'; target: Target; payload: N8AgenziaAddebitoPayload }
  | { tipo: 'N10_ADMIN_ESCALATION'; target: Target; payload: N10AdminEscalationPayload }
  | { tipo: 'N11_BROKER_ESCALATION'; target: Target; payload: N11BrokerEscalationPayload }
  | {
      tipo: 'N12_AFFILIAZIONE_COMMISSIONE';
      target: Target;
      payload: N12AffiliazioneCommissionePayload;
    }
  | {
      tipo: 'N13_BROKER_PRATICA_PROCESSATA';
      target: Target;
      payload: N13BrokerPraticaProcessataPayload;
    }
  | {
      tipo: 'N14_ACCOUNT_SOSPESO';
      target: Target;
      payload: N14AccountSospesoPayload;
    }
  | {
      tipo: 'N15_ACCOUNT_RIATTIVATO';
      target: Target;
      payload: N15AccountRiattivatoPayload;
    }
  | {
      tipo: 'N16_ACCOUNT_ELIMINATO';
      target: Target;
      payload: N16AccountEliminatoPayload;
    }
  | {
      tipo: 'N17_BROKER_PENALE_ADDEBITATA';
      target: Target;
      payload: N17BrokerPenaleAddebitataPayload;
    }
  | {
      tipo: 'N18_AGENZIA_SEGNALAZIONE_CONFERMATA';
      target: Target;
      payload: N18AgenziaSegnalazioneConfermataPayload;
    }
  | {
      tipo: 'N19_ADMIN_NUOVA_SEGNALAZIONE';
      target: Target;
      payload: N19AdminNuovaSegnalazionePayload;
    }
  | {
      tipo: 'N20_ADMIN_REVISIONE_RICHIESTA';
      target: Target;
      payload: N20AdminRevisioneRichiestaPayload;
    }
  | {
      tipo: 'N21_BROKER_REVISIONE_COMPLETATA';
      target: Target;
      payload: N21BrokerRevisioneCompletataPayload;
    }
  | {
      tipo: 'N22_REFERRAL_SIGNUP';
      target: Target;
      payload: N22ReferralSignupPayload;
    }
  | {
      tipo: 'N23_REFERRAL_FIRST_PRATICA';
      target: Target;
      payload: N23ReferralFirstPraticaPayload;
    }
  | {
      tipo: 'N24_PAYOUT_AFFILIATION_AVAILABLE';
      target: Target;
      payload: N24PayoutAffiliationAvailablePayload;
    }
  | {
      tipo: 'N25_MONTHLY_AFFILIATION_RECAP';
      target: Target;
      payload: N25MonthlyAffiliationRecapPayload;
    };

function render(input: SendInput): NotificaContent {
  switch (input.tipo) {
    case 'N1_BROKER_INVIO_PRATICA':
      return tplN1BrokerInvio(input.payload);
    case 'N2_BROKER_ACCETTATA':
      return tplN2BrokerAccettata(input.payload);
    case 'N3_BROKER_SOLLECITO':
      return tplN3BrokerSollecito(input.payload);
    case 'N4_BROKER_FIRMA_E_CREDITO':
      return tplN4BrokerFirma(input.payload);
    case 'N6_AGENZIA_NUOVA_PRATICA':
      return tplN6AgenziaNuova(input.payload);
    case 'N7_AGENZIA_PROMEMORIA_COUNTDOWN':
      return tplN7AgenziaPromemoriaCountdown(input.payload);
    case 'N8_AGENZIA_ADDEBITO':
      return tplN8AgenziaAddebito(input.payload);
    case 'N10_ADMIN_ESCALATION':
      return tplN10AdminEscalation(input.payload);
    case 'N11_BROKER_ESCALATION':
      return tplN11BrokerEscalation(input.payload);
    case 'N12_AFFILIAZIONE_COMMISSIONE':
      return tplN12AffiliazioneCommissione(input.payload);
    case 'N13_BROKER_PRATICA_PROCESSATA':
      return tplN13BrokerPraticaProcessata(input.payload);
    case 'N14_ACCOUNT_SOSPESO':
      return tplN14AccountSospeso(input.payload);
    case 'N15_ACCOUNT_RIATTIVATO':
      return tplN15AccountRiattivato(input.payload);
    case 'N16_ACCOUNT_ELIMINATO':
      return tplN16AccountEliminato(input.payload);
    case 'N17_BROKER_PENALE_ADDEBITATA':
      return tplN17BrokerPenaleAddebitata(input.payload);
    case 'N18_AGENZIA_SEGNALAZIONE_CONFERMATA':
      return tplN18AgenziaSegnalazioneConfermata(input.payload);
    case 'N19_ADMIN_NUOVA_SEGNALAZIONE':
      return tplN19AdminNuovaSegnalazione(input.payload);
    case 'N20_ADMIN_REVISIONE_RICHIESTA':
      return tplN20AdminRevisioneRichiesta(input.payload);
    case 'N21_BROKER_REVISIONE_COMPLETATA':
      return tplN21BrokerRevisioneCompletata(input.payload);
    case 'N22_REFERRAL_SIGNUP':
      return tplN22ReferralSignup(input.payload);
    case 'N23_REFERRAL_FIRST_PRATICA':
      return tplN23ReferralFirstPratica(input.payload);
    case 'N24_PAYOUT_AFFILIATION_AVAILABLE':
      return tplN24PayoutAffiliationAvailable(input.payload);
    case 'N25_MONTHLY_AFFILIATION_RECAP':
      return tplN25MonthlyAffiliationRecap(input.payload);
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
