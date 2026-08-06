import 'server-only';
import { prisma } from '@pv/db';

/**
 * Solo l'email di partenza CRM alimenta il funnel. Il tag `categoria` lo mette
 * già `ResendEmailProvider` a ogni invio (valore = NotificaTipo) e Resend lo
 * rimanda nel payload del webhook: senza questo filtro, una qualsiasi email
 * transazionale aperta da una persona che è anche un contatto CRM
 * accenderebbe `mailAperta`.
 */
const CATEGORIA_EMAIL_PARTENZA = 'N26_EMAIL_PARTENZA';
const MOTIVO_MAX = 500;

type ResendEvent = {
  type?: string;
  data?: {
    email_id?: string;
    tags?: Record<string, string>;
    bounce?: { type?: string; subType?: string; message?: string };
  };
};

/**
 * Applica un evento Resend già verificato al contatto CRM corrispondente.
 *
 * Idempotente per costruzione: le date di primo evento non vengono mai
 * sovrascritte, così la ripetizione di un evento (Svix ritenta finché non
 * riceve 200) è innocua senza bisogno di una tabella di deduplica.
 */
export async function handleResendEvent(evento: unknown): Promise<void> {
  const e = (evento ?? {}) as ResendEvent;
  const tipo = e.type;
  if (tipo !== 'email.opened' && tipo !== 'email.bounced') return;
  if (e.data?.tags?.categoria !== CATEGORIA_EMAIL_PARTENZA) return;

  const emailId = e.data?.email_id;
  if (!emailId) return;

  const notifica = await prisma.notificaInviata.findFirst({
    where: { providerRef: emailId },
    select: { id: true, crmContactId: true, readAt: true },
  });
  if (!notifica?.crmContactId) return;

  const contatto = await prisma.crmContact.findUnique({
    where: { id: notifica.crmContactId },
    select: { id: true, mailApertaAt: true },
  });
  if (!contatto) return;

  const ora = new Date();

  if (tipo === 'email.opened') {
    await prisma.crmContact.update({
      where: { id: contatto.id },
      data: { mailAperta: true, mailApertaAt: contatto.mailApertaAt ?? ora },
    });
    if (!notifica.readAt) {
      await prisma.notificaInviata.update({
        where: { id: notifica.id },
        data: { readAt: ora },
      });
    }
    return;
  }

  // Solo i bounce definitivi bloccano: casella piena o server temporaneamente
  // giù non devono impedire il reinvio a un cliente valido.
  //
  // ⚠️ Il campo giusto è `type`, NON `subType`. Resend deriva il bounce da SES:
  // `type` vale `Permanent` | `Temporary`, mentre `subType` è la classificazione
  // fine (`Suppressed`, `MessageRejected`, `General`…). Confrontare `subType`
  // con 'hard'/'soft' non matcherebbe mai, e il blocco non scatterebbe MAI —
  // in silenzio.
  const bounceType = e.data?.bounce?.type?.toLowerCase();
  if (!bounceType) {
    console.warn('[resend-webhook] bounce senza type, ignorato', emailId);
    return;
  }
  if (bounceType !== 'permanent' && bounceType !== 'temporary') {
    // Vocabolario inatteso: non blocchiamo (fail-safe), ma lo diciamo — è
    // l'unico modo per accorgersi che il contratto del provider è cambiato.
    console.warn('[resend-webhook] bounce con type sconosciuto', emailId, bounceType);
    return;
  }
  if (bounceType !== 'permanent') return;

  await prisma.crmContact.update({
    where: { id: contatto.id },
    data: {
      emailBouncedAt: ora,
      emailBounceMotivo: (e.data?.bounce?.message ?? '').slice(0, MOTIVO_MAX) || null,
    },
  });
}
