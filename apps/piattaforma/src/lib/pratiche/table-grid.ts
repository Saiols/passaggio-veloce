/**
 * Tracce della griglia della lista pratiche (header + righe).
 *
 * Header e righe NON sono la stessa griglia CSS: la classe viene applicata al
 * contenitore dell'header e poi a ogni singola riga (le righe devono restare
 * block-level, perché iOS Safari non onora `position: relative` dentro le
 * tabelle e lo stretched-link della riga si rompe). Di conseguenza una traccia
 * `auto` si dimensiona sul contenuto della PROPRIA griglia: la riga col
 * pulsante azione allarga "Stato", l'header no, e le colonne non combaciano.
 *
 * Qui nessuna traccia dipende dal contenuto: griglie di uguale larghezza
 * calcolano per forza le stesse colonne. Le celle testuali compensano con
 * `min-w-0 truncate`; la cella "Stato" con `flex-wrap`, così il pulsante azione
 * va a capo invece di allargare la traccia.
 *
 * Il numero di tracce per breakpoint deve combaciare con le celle VISIBILI a
 * quel breakpoint: le celle nascoste hanno `display:none` e non occupano
 * traccia. `table-grid.test.ts` blinda l'invariante.
 *
 * Le stringhe sono letterali per intero: Tailwind non risolve nomi di classe
 * costruiti a runtime.
 */
export const PRATICHE_GRID = {
  /** Codice · Targa · Proprietario(sm) · Controparte(md) · Stato · Fee(lg) · Quando */
  utenteSenzaSede:
    'grid-cols-[8.5rem_minmax(0,1fr)_7.5rem_6.5rem] ' +
    'sm:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_9.5rem_6.5rem] ' +
    'md:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_minmax(0,1fr)_9.5rem_6.5rem] ' +
    'lg:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_minmax(0,1fr)_9.5rem_5rem_7rem]',

  /** Come sopra, con Sede(lg) fra Controparte e Stato. */
  utenteConSede:
    'grid-cols-[8.5rem_minmax(0,1fr)_7.5rem_6.5rem] ' +
    'sm:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_9.5rem_6.5rem] ' +
    'md:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_minmax(0,1fr)_9.5rem_6.5rem] ' +
    'lg:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_9.5rem_5rem_7rem]',

  /** Codice · Targa · Broker(md) · Agenzia(md) · Sede(lg) · Stato · Fee(lg) · Quando */
  admin:
    'grid-cols-[8.5rem_minmax(0,1fr)_7.5rem_6.5rem] ' +
    'sm:grid-cols-[8.5rem_minmax(0,1fr)_9.5rem_6.5rem] ' +
    'md:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_minmax(0,1fr)_9.5rem_6.5rem] ' +
    'lg:grid-cols-[8.5rem_6.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_9.5rem_5rem_7rem]',
} as const;

/**
 * Larghezza minima del contenuto della tabella: sotto questa soglia il
 * contenitore scorre in orizzontale invece di tagliare le colonne in silenzio.
 *
 * Somma delle tracce fisse del breakpoint base (8.5 + 7.5 + 6.5 = 22.5rem) più
 * lo spazio che la targa deve avere per non venire troncata (~6.5rem). Se
 * cambi le larghezze base, ricalcola questo valore: se resta troppo basso la
 * colonna targa si schiaccia invece di far scorrere la tabella.
 */
export const PRATICHE_TABLE_MIN_W = 'min-w-[29rem]';
