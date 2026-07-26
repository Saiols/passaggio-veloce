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
 */
export async function riconciliaFattureIncassate(): Promise<{
  emesse: number;
  notificate: number;
}> {
  const da = new Date(Date.now() - FINESTRA_MS);
  const fees = await prisma.feeAddebito.findMany({
    where: { stato: 'SUCCESS', executedAt: { gte: da } },
    take: BATCH_SIZE,
    orderBy: { executedAt: 'asc' },
    select: { id: true, praticaId: true },
  });

  let emesse = 0;
  let notificate = 0;

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
        await notificaFatturaDisponibile(creato.id).catch((err) => {
          console.error(`[riconciliaFatture] N53 fallita per documento ${creato.id}:`, err);
        });
        notificate++;
      }
      continue;
    }

    if (!doc.inviatoEmailAt) {
      await notificaFatturaDisponibile(doc.id).catch((err) => {
        console.error(`[riconciliaFatture] N53 fallita per documento ${doc.id}:`, err);
      });
      notificate++;
    }
  }

  return { emesse, notificate };
}
