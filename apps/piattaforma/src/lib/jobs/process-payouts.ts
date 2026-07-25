import 'server-only';
import { prisma } from '@pv/db';
import { settlePayout } from '@/lib/wallet/payout-exec';
import { payoutBloccatoPerSospensione } from '@/lib/wallet/sospensione-payout';

const BATCH_SIZE = 20;

export type ProcessPayoutsResult = {
  processed: number;
  succeeded: number;
  failed: number;
  // Righe RICHIESTO lette dal batch ma MAI passate a `settlePayout` perché il
  // guard sospensione (sotto) le ha saltate: prima di questo contatore
  // `processed` (= `payouts.length`, il numero di righe lette) le includeva
  // silenziosamente insieme a `succeeded`/`failed`, facendo sembrare
  // "tentate" righe che il job non ha nemmeno provato a saldare — fuorviante
  // proprio quando il guard scatta spesso (azienda sospesa a lungo). Invariante:
  // `processed === succeeded + failed + skipped`.
  skipped: number;
};

/**
 * Job payout (path AUTO): prende i Payout RICHIESTO (creati da
 * `triggerAutoPayout`) e li salda uno per uno tramite `settlePayout` — stesso
 * motore del payout istantaneo (provider + safeguard + documento broker).
 * Come il payout manuale, opera anche in mock (Strada B): il safeguard sui soldi
 * reali vive nel provider dentro `settlePayout`.
 *
 * ⚠️ GUARD DI TRIO (terzo punto, sul SALDO anziché sulla creazione): una riga
 * `RICHIESTO` può essere stata creata PRIMA di una sospensione — finestra fra
 * i due cron (`trigger-auto-payout` alle 01:00, questo job alle 01:30), riga
 * già in coda al deploy, residuo oltre `BATCH_SIZE`, o lasciata da un run
 * fallito — e `settlePayout` (lib/wallet/payout-exec.ts) non ha alcun guard
 * di dominio: risolve l'IBAN e chiama il provider di pagamento senza
 * controllare nulla. I due punti gemelli (`eseguiPayoutImmediato` in
 * payout-exec.ts, `triggerAutoPayout` in trigger-auto-payout.ts) guardano
 * solo al momento della CREAZIONE del Payout: non vedono una riga già
 * `RICHIESTO` al momento in cui l'azienda viene sospesa. Predicato condiviso
 * in lib/wallet/sospensione-payout.ts — se cambi una condizione qui, guarda
 * anche là.
 *
 * Si SALTA (continue), non si annulla: la riga resta `RICHIESTO` — nessuna
 * scrittura di stato su di essa — e verrà saldata al prossimo giro dopo la
 * riattivazione. Non è una via per intrappolare il denaro: la liquidazione di
 * cessazione (clausola 12.4) non passa da qui, passa da
 * `eseguiPayoutImmediato(..., { ignoraSoglia: true })`, che per progetto
 * ignora la sospensione.
 */
export async function processPayouts(): Promise<ProcessPayoutsResult> {
  const payouts = await prisma.payout.findMany({
    where: { stato: 'RICHIESTO' },
    take: BATCH_SIZE,
    orderBy: { richiestoAt: 'asc' },
    select: {
      id: true,
      // `suspendedAt` per entrambe le forme di proprietà del wallet nello
      // stesso select: nessuna query in più nel ciclo (una per payout sarebbe
      // un N+1 sul batch).
      wallet: {
        select: {
          company: { select: { suspendedAt: true } },
          sede: { select: { company: { select: { suspendedAt: true } } } },
        },
      },
    },
  });

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const payout of payouts) {
    if (payoutBloccatoPerSospensione(payout.wallet)) {
      skipped++;
      continue;
    }

    await prisma.payout.update({
      where: { id: payout.id },
      data: { stato: 'IN_LAVORAZIONE' },
    });
    const res = await settlePayout(payout.id);
    if (res.ok) succeeded++;
    else failed++;
  }

  return { processed: payouts.length, succeeded, failed, skipped };
}
