import 'server-only';
import { prisma } from '@pv/db';
import { env } from '@/env';
import { sendNotification } from '@/lib/notifiche';
import { fatturaPvAttachment } from './documento-pdf';

/**
 * N53 "fattura disponibile" per una FATTURA_PV appena emessa.
 *
 * Recapito: admin azienda della MADRE, non il risolutore per sede. Le email che
 * portano un documento fiscale seguono la stessa regola della N8 — l'entità
 * legale, non chi ha lavorato la pratica.
 *
 * `inviatoEmailAt` è il guardiano dell'unicità: il percorso d'incasso e la
 * riconciliazione oraria chiamano questa funzione senza conoscersi. Per questo
 * si scrive con una prenotazione atomica (`updateMany` con `WHERE
 * inviatoEmailAt IS NULL`) PRIMA di inviare, non dopo: `sendNotification` non
 * riporta al chiamante l'esito del provider, quindi scrivere dopo non direbbe
 * nulla sull'esito reale e lascerebbe la porta aperta alla doppia email in caso
 * di corsa fra i due chiamanti.
 *
 * Ritorna `true` SOLO se ha davvero chiamato `sendNotification` senza
 * eccezioni. Tutte le uscite anticipate (documento assente, già inviato,
 * destinatario o email mancanti, prenotazione persa) ritornano `false`: i
 * contatori dei chiamanti non devono spacciare per invii dei no-op che si
 * ripetono identici ogni ora.
 */
export async function notificaFatturaDisponibile(documentoId: string): Promise<boolean> {
  const doc = await prisma.documentoFiscale.findUnique({
    where: { id: documentoId },
    select: {
      id: true,
      praticaId: true,
      numeroDocumentoStr: true,
      importoLordoCent: true,
      inviatoEmailAt: true,
      pratica: { select: { codicePratica: true } },
      destinatarioCompany: {
        select: {
          id: true,
          ragioneSociale: true,
          email: true,
          users: {
            where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
            select: { id: true, email: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!doc || doc.inviatoEmailAt || !doc.destinatarioCompany || !doc.praticaId) return false;

  const admin = doc.destinatarioCompany.users[0];
  // Ripiego sull'email azienda come fanno N3/N6/N8/N9: una fattura non deve
  // sparire in silenzio perché manca un admin attivo.
  const email = admin?.email ?? doc.destinatarioCompany.email;
  if (!email) return false;

  const allegato = await fatturaPvAttachment(doc.praticaId).catch((err) => {
    console.error(`[notificaFatturaDisponibile] allegato non generato per documento ${doc.id}:`, err);
    return null;
  });

  // Prenotazione atomica: `inviatoEmailAt` si scrive PRIMA dell'invio, non dopo.
  // `sendNotification` non riporta l'esito del provider al chiamante (un invio
  // rifiutato da Resend finisce in `NotificaInviata.stato = FAILED` e basta),
  // quindi scriverlo dopo non direbbe nulla sull'esito reale e lascerebbe due
  // chiamanti — percorso d'incasso e riconciliazione oraria — liberi di leggere
  // `null` entrambi e mandare due volte la stessa fattura. Chi perde la
  // prenotazione esce.
  const prenotazione = await prisma.documentoFiscale.updateMany({
    where: { id: doc.id, inviatoEmailAt: null },
    data: { inviatoEmailAt: new Date() },
  });
  if (prenotazione.count === 0) return false;

  try {
    // `sendNotification` non lancia sugli errori del PROVIDER, ma lancia su
    // tutto ciò che sta prima del suo try/catch: render del template, lookup
    // preferenze e pratica, e la `create` di NotificaInviata.
    await sendNotification(
      {
        tipo: 'N53_AGENZIA_FATTURA_DISPONIBILE',
        target: { email, userId: admin?.id ?? null, companyId: doc.destinatarioCompany.id },
        payload: {
          nomeAgenzia: doc.destinatarioCompany.ragioneSociale,
          codicePratica: doc.pratica?.codicePratica ?? '—',
          numeroDocumento: doc.numeroDocumentoStr ?? '—',
          importoCent: doc.importoLordoCent,
          fatturaAllegata: allegato != null,
          // Link funzionale: NEXT_PUBLIC_APP_URL, mai BRAND.url (dominio marketing).
          fatturaUrl: `${env.NEXT_PUBLIC_APP_URL}/fatturazione`,
        },
      },
      { praticaId: doc.praticaId, ...(allegato ? { attachments: [allegato] } : {}) },
    );
  } catch (err) {
    // La prenotazione è un lock, non una prova di consegna: se l'invio non è
    // nemmeno partito va rilasciata, altrimenti la riconciliazione oraria
    // considera inviata una fattura che l'agenzia non ha mai ricevuto.
    // Caso concreto: codice in produzione prima che la migration dell'enum
    // NotificaTipo sia applicata su Neon — ogni N53 esplode sulla create di
    // NotificaInviata e marcherebbe il documento come inviato per sempre.
    await prisma.documentoFiscale
      .updateMany({ where: { id: doc.id }, data: { inviatoEmailAt: null } })
      .catch((e) =>
        console.error(
          `[notificaFatturaDisponibile] rilascio prenotazione fallito per documento ${doc.id}:`,
          e,
        ),
      );
    throw err;
  }

  return true;
}
