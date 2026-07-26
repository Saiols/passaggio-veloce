import 'server-only';
import { prisma } from '@pv/db';
import { createFatturaPv } from '@/lib/fatturazione/engine';
import { notificaFatturaDisponibile } from '@/lib/fatturazione/notifica-fattura';

const FINESTRA_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 30;

/**
 * Rete per gli incassi rimasti senza il loro documento o senza la loro email:
 * `createFatturaPv` fallita dopo un SUCCESS, oppure N53 non partita. Non si
 * annulla un incasso perché un PDF è andato storto — si recupera qui.
 *
 * Parte dai FEE e non dai documenti: così in modalità mock è automaticamente
 * inerte, perché lì nessun fee arriva mai a SUCCESS e la fattura è già stata
 * emessa alla firma dalla valvola.
 *
 * Interroga i documenti per `praticaId` (che ha un indice) e non per
 * `feeAddebitoId` (che non ce l'ha): niente migration.
 *
 * Non lancia mai: un guasto a metà passata (lettura fee/documenti, o un item
 * imprevisto) viene loggato e la funzione ritorna comunque, ma con i contatori
 * del lavoro davvero fatto FINO A quel punto — non azzerati. Il chiamante (il
 * cron di process-fee-scheduled) ha già ottenuto e restituito il risultato di
 * `processFeeScheduled` — quel risultato non deve mai andare perso perché
 * questa passata di recupero, che gira nella stessa richiesta, si è
 * interrotta a metà.
 */
export async function riconciliaFattureIncassate(): Promise<{
  emesse: number;
  notificate: number;
}> {
  let emesse = 0;
  let notificate = 0;

  try {
    const da = new Date(Date.now() - FINESTRA_MS);
    const fees = await prisma.feeAddebito.findMany({
      where: { stato: 'SUCCESS', executedAt: { gte: da } },
      take: BATCH_SIZE,
      orderBy: { executedAt: 'asc' },
      select: { id: true, praticaId: true },
    });

    for (const fee of fees) {
      const doc = await prisma.documentoFiscale.findFirst({
        where: { praticaId: fee.praticaId, tipo: 'FATTURA_PV' },
        select: { id: true, inviatoEmailAt: true },
      });

      if (!doc) {
        const creato = await createFatturaPv({
          feeAddebitoId: fee.id,
          statoPagamento: 'PAGATA',
        }).catch((err) => {
          console.error(`[riconciliaFatture] emissione fallita per fee ${fee.id}:`, err);
          return null;
        });
        if (creato) {
          emesse++;
          const inviata = await notificaFatturaDisponibile(creato.id)
            .then(() => true)
            .catch((err) => {
              console.error(`[riconciliaFatture] N53 fallita per documento ${creato.id}:`, err);
              return false;
            });
          if (inviata) notificate++;
        }
        continue;
      }

      if (!doc.inviatoEmailAt) {
        const inviata = await notificaFatturaDisponibile(doc.id)
          .then(() => true)
          .catch((err) => {
            console.error(`[riconciliaFatture] N53 fallita per documento ${doc.id}:`, err);
            return false;
          });
        if (inviata) notificate++;
      }
    }
  } catch (err) {
    console.error('[riconciliaFatture] passata interrotta:', err);
  }

  return { emesse, notificate };
}
