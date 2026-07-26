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
 * riconciliazione oraria chiamano questa funzione senza conoscersi.
 */
export async function notificaFatturaDisponibile(documentoId: string): Promise<void> {
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
  if (!doc || doc.inviatoEmailAt || !doc.destinatarioCompany || !doc.praticaId) return;

  const admin = doc.destinatarioCompany.users[0];
  // Ripiego sull'email azienda come fanno N3/N6/N8/N9: una fattura non deve
  // sparire in silenzio perché manca un admin attivo.
  const email = admin?.email ?? doc.destinatarioCompany.email;
  if (!email) return;

  const allegato = await fatturaPvAttachment(doc.praticaId).catch(() => null);

  await sendNotification(
    {
      tipo: 'N53_AGENZIA_FATTURA_DISPONIBILE',
      target: { email, userId: admin?.id ?? null, companyId: doc.destinatarioCompany.id },
      payload: {
        nomeAgenzia: doc.destinatarioCompany.ragioneSociale,
        codicePratica: doc.pratica?.codicePratica ?? '—',
        numeroDocumento: doc.numeroDocumentoStr ?? '—',
        importoCent: doc.importoLordoCent,
        // Link funzionale: NEXT_PUBLIC_APP_URL, mai BRAND.url (dominio marketing).
        fatturaUrl: `${env.NEXT_PUBLIC_APP_URL}/fatturazione`,
      },
    },
    { praticaId: doc.praticaId, ...(allegato ? { attachments: [allegato] } : {}) },
  );

  await prisma.documentoFiscale.update({
    where: { id: doc.id },
    data: { inviatoEmailAt: new Date() },
  });
}
