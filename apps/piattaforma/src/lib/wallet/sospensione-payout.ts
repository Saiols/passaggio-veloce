/**
 * Guard di sospensione condiviso dai TRE punti che creano o saldano un payout
 * (⚠️ GUARD DI TRIO — se cambi una condizione qui, aggiorna tutti e tre):
 *
 *  - `lib/wallet/payout-exec.ts` (`eseguiPayoutImmediato`): payout manuale e
 *    auto-payout a soglia in tempo reale — crea E salda nello stesso giro;
 *  - `lib/jobs/trigger-auto-payout.ts` (`triggerAutoPayout`): rete di sicurezza
 *    notturna, che NON passa da `eseguiPayoutImmediato` — crea il Payout
 *    `RICHIESTO` e lo lascia saldare da `processPayouts` → `settlePayout`;
 *  - `lib/jobs/process-payouts.ts` (`processPayouts`): salda le righe
 *    `RICHIESTO` esistenti, comprese quelle create PRIMA di una sospensione
 *    (finestra fra i due cron, residuo di batch, run fallito). Nessuno dei due
 *    guard sopra la vede: controllano solo al momento della CREAZIONE, non al
 *    momento del SALDO — e `settlePayout` di suo non ha alcun guard di dominio.
 *
 * Il secondo punto è la ragione per cui questo modulo esiste: con il guard
 * nel solo motore, una sospensione non bloccava il payout automatico, lo
 * rimandava di una notte (il trigger in tempo reale rifiutava, il saldo restava
 * sopra soglia, il cron notturno pagava). Il terzo è arrivato dopo: la
 * re-review ha trovato che il buco era chiuso sulla CREAZIONE ma non sul
 * SALDO — una riga `RICHIESTO` già esistente al momento della sospensione
 * veniva pagata comunque.
 *
 * Modulo PURO, nessuna query: tutti e tre i chiamanti risolvono già la company
 * proprietaria del wallet nel proprio `select`, e una lettura per `companyId`
 * qui dentro diventerebbe una query per wallet (o per payout) nel ciclo del
 * cron.
 *
 * La forma del parametro è ciò che tiene insieme il trio: se un domani il
 * blocco dovrà guardare un altro campo, aggiungerlo a
 * `ProprietarioWalletPayout` fa fallire la compilazione di TUTTI i chiamanti
 * finché non lo aggiungono al proprio `select`.
 */

/**
 * Le DUE forme di proprietà di un wallet, entrambe producibili dal write path:
 * wallet della madre (affiliazione) → `company` diretta, `sede: null`; wallet
 * operativo → `sede`, e la company sta sotto la sede.
 */
export type ProprietarioWalletPayout = {
  company: { suspendedAt: Date | null } | null;
  sede: { company: { suspendedAt: Date | null } } | null;
};

/**
 * Messaggio unico del rifiuto per sospensione lato payout. Non è
 * `ERRORE_SOSPENSIONE` (quello generico delle action): qui va detto anche che
 * il saldo non è perduto, altrimenti la prima reazione è pensare a un
 * sequestro del credito maturato.
 */
export const ERRORE_PAYOUT_SOSPESO =
  'Il tuo account è sospeso: i prelievi dal wallet sono bloccati finché la sospensione non viene revocata. Il saldo resta a tuo credito.';

/**
 * Sospensione dell'AZIENDA (non dell'utente): un payout è un movimento di
 * denaro aziendale, e se è sospeso un solo utente i colleghi restano
 * legittimati — l'asimmetria è deliberata.
 */
export function payoutBloccatoPerSospensione(
  w: ProprietarioWalletPayout | null | undefined,
): boolean {
  return (w?.company?.suspendedAt ?? w?.sede?.company?.suspendedAt ?? null) != null;
}
