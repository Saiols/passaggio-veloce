import 'server-only';
import { prisma } from '@pv/db';
import { payoutBloccatoPerSospensione } from '@/lib/wallet/sospensione-payout';
import { isVisuraScadutaCompany } from '@/lib/visura/stato';

export type TriggerAutoPayoutResult = { created: number };

/**
 * Cron payout: per ogni wallet, confronta il saldo con la soglia
 * configurata sulla company di appartenenza (item 12 release 2026-05).
 * Filtriamo lato applicazione anziche' lato DB per non duplicare la
 * regola: e' una query bottleneck periodica, non hot path.
 *
 * Rete di sicurezza periodica: l'innesco primario è real-time (vedi
 * `maybeAutoPayoutForWallet`, chiamato dopo gli accrediti). Come il payout
 * MANUALE, funziona anche in mock (Strada B): il safeguard sui soldi reali vive
 * nel provider dentro `settlePayout`, non qui.
 *
 * Clausole 8 e 12.3 dei Termini: questo path NON passa da
 * `eseguiPayoutImmediato` (crea il Payout direttamente, `processPayouts` lo
 * salda via `settlePayout`), quindi i guard sulla visura camerale scaduta e
 * sulla sospensione dell'azienda vanno replicati qui — altrimenti la rete di
 * sicurezza periodica pagherebbe un wallet anche quando la visura dell'azienda
 * è scaduta o quando l'azienda è sospesa, riaprendo lo stesso buco chiuso in
 * `eseguiPayoutImmediato`. Il guard sospensione è arrivato per ultimo
 * proprio così: nato nel solo motore, non bloccava il payout automatico, lo
 * rimandava di una notte (il trigger in tempo reale rifiutava, il saldo restava
 * sopra soglia, questo cron pagava). Chiudere QUI non basta comunque: una riga
 * `RICHIESTO` che questo job ha già creato prima che l'azienda venisse sospesa
 * arriva a `processPayouts` (lib/jobs/process-payouts.ts) comunque sospesa —
 * terzo punto del guard (⚠️ GUARD DI TRIO, vedi lib/wallet/sospensione-payout.ts),
 * quello sul SALDO anziché sulla creazione.
 *
 * Non c'è eccezione `ignoraSoglia` qui: questo path serve solo l'auto-payout
 * ordinario, mai la liquidazione di cessazione (quella passa da
 * `deleteCompanyAction`).
 */
export async function triggerAutoPayout(): Promise<TriggerAutoPayoutResult> {
  const wallets = await prisma.wallet.findMany({
    select: {
      id: true,
      saldoCent: true,
      companyId: true,
      // Multi-sede: soglia del wallet di sede (operativo) o della madre (affiliazione).
      // `suspendedAt` viaggia nello stesso select per entrambe le forme di
      // proprietà: nessuna query in più nel ciclo.
      sede: {
        select: {
          payoutThresholdCent: true,
          companyId: true,
          company: { select: { suspendedAt: true } },
        },
      },
      company: { select: { payoutThresholdCent: true, suspendedAt: true } },
    },
  });

  let created = 0;
  for (const w of wallets) {
    const threshold = w.sede?.payoutThresholdCent ?? w.company?.payoutThresholdCent ?? 100000;
    if (w.saldoCent < threshold) continue;

    const companyId = w.companyId ?? w.sede?.companyId ?? null;

    // Sospensione dell'azienda proprietaria del wallet: stesso guard di
    // `eseguiPayoutImmediato` (lib/wallet/payout-exec.ts, ⚠️ GUARD DI TRIO) e
    // di `processPayouts` (lib/jobs/process-payouts.ts, terzo punto — quello
    // sul SALDO, per le righe già `RICHIESTO` prima della sospensione),
    // predicato condiviso in lib/wallet/sospensione-payout.ts — il trio va
    // tenuto allineato. Qui non esiste `ignoraSoglia` (vedi docstring), quindi
    // nessuna esenzione. Primo dei tre guard di QUESTA funzione perché è
    // l'unico a costo zero: non interroga il DB.
    if (payoutBloccatoPerSospensione(w)) continue;

    // Nessun guard sul saldo negativo di ALTRI wallet: dal documento v8 dei
    // Termini (2026-07-26) la clausola 5 confina il blocco al wallet in rosso,
    // e questo wallet è già sopra soglia (quindi positivo) per il `continue`
    // qui sopra. Prima c'era `hasNegativeCompanyWallet`, rimosso insieme al
    // gemello di `eseguiPayoutImmediato`.
    if (companyId && (await isVisuraScadutaCompany(companyId))) continue;

    const inflight = await prisma.payout.findFirst({
      where: { walletId: w.id, stato: { in: ['RICHIESTO', 'IN_LAVORAZIONE'] } },
    });
    if (inflight) continue;

    await prisma.payout.create({
      data: {
        walletId: w.id,
        importoCent: w.saldoCent,
        stato: 'RICHIESTO',
        automatico: true,
      },
    });
    created++;
  }
  return { created };
}
