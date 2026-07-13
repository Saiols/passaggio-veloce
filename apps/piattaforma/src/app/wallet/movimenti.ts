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
 * La pratica collegata è di un ALTRO soggetto: quella dell'affiliato.
 *
 * Una `CREDITO_AFFILIAZIONE` porta il `praticaId` della pratica che ha generato
 * la commissione, cioè una pratica del referral — non del referente che la vede
 * nel wallet. Chi legge questa riga è, per definizione, fuori da quella pratica:
 * ne mostriamo il codice (serve a riconciliare l'importo) ma non i dati (targa)
 * né un link al dettaglio.
 *
 * Il link, oltretutto, non ha mai funzionato: `/pratiche/[id]` è scopato alla
 * propria company e rispondeva `notFound()`. Toglierlo non perde una funzione,
 * chiude un'esposizione.
 */
export function isAffiliazione(tipo: string): boolean {
  return tipo === 'CREDITO_AFFILIAZIONE';
}

/**
 * Classi della riga di una penale.
 *
 * L'importo è già rosso per OGNI movimento negativo, payout compresi: senza un
 * secondo segnale una sanzione non si distingue da un incasso. Il fondo resta
 * dentro il padding della lista — niente margini negativi da accordare al
 * padding della `Card`, che è `p-5 sm:p-6` e cambia al breakpoint.
 *
 * Il segnale è una `box-shadow` inset, non un `border-l`. Entrambe le viste
 * mettono questa riga dentro una lista `divide-y divide-pv-slate-200`, che
 * dipinge un separatore di 1px in basso su ogni riga tranne l'ultima. Un
 * `border-pv-red-500` sulla riga imposta la shorthand `border-color`, che
 * copre tutti e quattro i lati: ridipingerebbe di rosso anche quel
 * separatore, sottolineando la riga. Una `box-shadow` non tocca nessuna
 * proprietà `border-*`, quindi il separatore resta grigio e la barra resta
 * rossa in qualunque posizione della lista.
 */
export const CLASSI_RIGA_PENALE =
  'bg-pv-red-50/40 pl-3 pr-2 rounded-r-[6px] shadow-[inset_2px_0_0_var(--color-pv-red-500)]';
