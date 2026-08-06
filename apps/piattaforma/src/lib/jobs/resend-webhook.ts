import 'server-only';
import { prisma } from '@pv/db';

/**
 * Solo l'email di partenza CRM alimenta il funnel. La garanzia VERA che
 * nessun'altra email lo sporchi è `NotificaInviata.crmContactId` (controllo
 * `if (!notifica?.crmContactId) return` più sotto): la scrive un solo
 * chiamante in tutto il repo (`sendEmailPartenzaAction` via `sendNotification`),
 * quindi nessuna notifica diversa da N26 può averla valorizzata, a prescindere
 * dal filtro sul tag.
 *
 * Il filtro su `tags.categoria` qui sotto NON è quella garanzia: è
 * un'ottimizzazione che risparmia le due query quando l'evento non è nemmeno
 * un'email di partenza. `ResendEmailProvider` tagga già ogni invio
 * (`categoria = <NotificaTipo>`, `lib/providers/email/resend.ts`), Resend lo
 * rimanda nel payload, e `N26_EMAIL_PARTENZA` sopravvive intatto a
 * `sanitizeTagValue`. Resend documenta i tag in uscita come **array** e qui li
 * leggiamo come **oggetto** (`e.data?.tags?.categoria`): asimmetria verificata
 * sul payload reale, ma la stessa forma di rischio che è già costata un giro
 * di fix con `subType` — se l'assunzione cambia, ogni evento esce da questo
 * filtro e la feature diventa un no-op totale. Per questo, sotto, lo scarto
 * viene loggato invece di sparire in silenzio.
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
  if (e.data?.tags?.categoria !== CATEGORIA_EMAIL_PARTENZA) {
    console.warn(
      '[resend-webhook] evento scartato dal filtro categoria',
      tipo,
      e.data?.tags?.categoria,
    );
    return;
  }

  const emailId = e.data?.email_id;
  if (!emailId) return;

  const notifica = await prisma.notificaInviata.findFirst({
    where: { providerRef: emailId },
    select: { id: true, crmContactId: true, readAt: true, destinazione: true },
  });
  if (!notifica?.crmContactId) return;

  const contatto = await prisma.crmContact.findUnique({
    where: { id: notifica.crmContactId },
    select: { id: true, mailApertaAt: true, email: true },
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
  // Effetto identico a `if (bounceType !== 'permanent') return`: a questo
  // punto `bounceType` può essere SOLO 'permanent' o 'temporary' (il ramo
  // sopra ha già gestito ogni altro valore). NON rimuoverla: è l'unica riga
  // che fa uscire i bounce temporanei senza bloccare, ed è coperta dal test
  // "bounce temporaneo: nessuna scrittura, nessun blocco".
  if (bounceType === 'temporary') return;

  // Blocca SOLO se l'indirizzo che ha rimbalzato è quello del contatto.
  // `sendEmailPartenzaAction` manda la stessa email anche agli "indirizzi
  // aggiuntivi" digitati a mano dall'operatore — stesso `crmContactId` per
  // tutti, perché per le APERTURE l'attribuzione larga è corretta (se il
  // titolare apre da una casella personale, il contatto ha aperto davvero).
  // Per i bounce no: quegli indirizzi manuali sono i più esposti agli hard
  // bounce di tutto il sistema (nessuno li valida mai), e bloccare il
  // contatto per il rimbalzo di un indirizzo che non è il suo metterebbe il
  // badge rosso e il messaggio di blocco su un'email che non c'entra.
  const destinazione = notifica.destinazione.toLowerCase();
  const emailContatto = contatto.email?.toLowerCase() ?? null;
  if (!emailContatto || destinazione !== emailContatto) {
    console.warn(
      '[resend-webhook] bounce su un indirizzo diverso da quello del contatto: nessun blocco',
      emailId,
    );
    return;
  }

  await prisma.crmContact.update({
    where: { id: contatto.id },
    data: {
      emailBouncedAt: ora,
      emailBounceMotivo: (e.data?.bounce?.message ?? '').slice(0, MOTIVO_MAX) || null,
    },
  });
}
