/**
 * Presentazione dei movimenti wallet, condivisa dalle due viste che li elencano:
 * `page.tsx` (singola sede) e `wallet-aggregato.tsx` (proprietario).
 *
 * Sta qui perché "cos'è una penale" e "che aspetto ha" devono avere una fonte
 * sola: due copie divergono al primo tipo nuovo.
 */

/** Etichetta leggibile del tipo di movimento; ricade sul valore grezzo se sconosciuto. */
export function labelTipoTx(tipo: string): string {
  if (tipo === 'CREDITO_PRATICA') return 'Credito pratica firmata';
  if (tipo === 'CREDITO_AFFILIAZIONE') return 'Commissione affiliazione';
  if (tipo === 'CREDITO_PROMO') return 'Bonus promozionale';
  if (tipo === 'PAYOUT_AUTOMATICO') return 'Payout automatico';
  if (tipo === 'PAYOUT_MANUALE') return 'Payout manuale';
  if (tipo === 'RETTIFICA_ADMIN') return 'Rettifica admin';
  if (tipo === 'STORNO') return 'Storno';
  if (tipo === 'PENALE_BROKER') return 'Penale segnalazione';
  return tipo;
}

/**
 * Solo l'addebito della sanzione.
 *
 * Lo `STORNO` che a volte l'accompagna nel flusso penale è il recupero di un
 * compenso già accreditato, non una sanzione; e una `RETTIFICA_ADMIN` negativa
 * può essere una semplice correzione contabile. Evidenziare per errore è peggio
 * che non evidenziare, quindi un tipo nuovo resta non evidenziato finché
 * qualcuno non lo dichiara qui.
 */
export function isPenale(tipo: string): boolean {
  return tipo === 'PENALE_BROKER';
}

/**
 * Classi della riga di una penale.
 *
 * L'importo è già rosso per OGNI movimento negativo, payout compresi: senza un
 * secondo segnale una sanzione non si distingue da un incasso. Il fondo resta
 * dentro il padding della lista — niente margini negativi da accordare al
 * padding della `Card`, che è `p-5 sm:p-6` e cambia al breakpoint.
 */
export const CLASSI_RIGA_PENALE =
  'border-l-2 border-pv-red-500 bg-pv-red-50/40 pl-3 pr-2 rounded-r-[6px]';
