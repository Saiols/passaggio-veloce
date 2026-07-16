/**
 * FONTE UNICA della validità della visura camerale **dell'organizzazione
 * iscritta** (broker/agenzia): registrazione e ciclo di vita successivo.
 *
 * ⚠️ NON è la fonte per la visura di venditori/acquirenti dentro una pratica:
 * quella è `lib/kyc/parte-docs.ts` (`VISURA_VALIDITA_MESI = 6`, e la freschezza
 * si applica solo ai commercianti d'auto). Sono due domini diversi con regole
 * diverse: NON unificarli. Accorparli cambierebbe in silenzio le regole
 * documentali delle pratiche.
 *
 * Puro: niente IO, niente `server-only` (lo usano anche wizard e banner).
 */
import { romeYmd } from '@/lib/date/rome-day';

/** Una visura vale 180 giorni. Dal giorno 180 è scaduta (confine `>=`). */
export const VISURA_VALIDITA_GIORNI = 180;

/** Giorni di preavviso prima della scadenza: finestra 175..179. */
export const PREAVVISO_GIORNI = 5;

const MS_PER_DAY = 86_400_000;

/** Numero seriale del giorno di calendario (giorni dall'epoch). */
function civilDay(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/**
 * Giorni di calendario trascorsi dall'emissione a oggi.
 *
 * `emissione` arriva da Prisma come colonna `@db.Date` → Date a mezzanotte UTC:
 * si legge in UTC. `oggi` è un istante: si legge nel **giorno di Roma**, perché
 * è il giorno in cui vive l'azienda. Il conteggio è per giorni di calendario,
 * non per multipli di 24h: così il cambio di ora legale non fa sparire un giorno.
 */
export function giorniTrascorsi(emissione: Date, oggi: Date): number {
  const e = civilDay(emissione.getUTCFullYear(), emissione.getUTCMonth() + 1, emissione.getUTCDate());
  const [y, m, d] = romeYmd(oggi);
  return civilDay(y, m, d) - e;
}

/**
 * `null` → MAI scaduta: non si afferma la scadenza di una data che non si ha.
 * È strutturale: `visuraCameraleData` si popola solo se il gate KYC passa, quindi
 * null ⟺ registrazione in DEMO_MODE oppure account creato da seed/admin.
 */
export function isVisuraScaduta(emissione: Date | null, oggi: Date): boolean {
  if (!emissione) return false;
  return giorniTrascorsi(emissione, oggi) >= VISURA_VALIDITA_GIORNI;
}

/** Finestra di preavviso: 175..179. Al giorno 180 è scaduta, non "in preavviso". */
export function isInPreavviso(emissione: Date | null, oggi: Date): boolean {
  if (!emissione) return false;
  const g = giorniTrascorsi(emissione, oggi);
  return g >= VISURA_VALIDITA_GIORNI - PREAVVISO_GIORNI && g < VISURA_VALIDITA_GIORNI;
}

/** Giorni che restano prima del blocco. Mai negativo: 0 = scaduta. */
export function giorniRimanenti(emissione: Date, oggi: Date): number {
  return Math.max(0, VISURA_VALIDITA_GIORNI - giorniTrascorsi(emissione, oggi));
}

/**
 * Soglia per i `where` Prisma: una visura è **valida** ⟺
 * `visuraCameraleData > limiteVisuraUtc(oggi)`.
 *
 * Deve restare coerente con `isVisuraScaduta` — il test lo verifica su entrambe.
 * Ricordarsi sempre il ramo `{ visuraCameraleData: null }` in OR: i null sono esenti.
 */
export function limiteVisuraUtc(oggi: Date): Date {
  const [y, m, d] = romeYmd(oggi);
  return new Date(Date.UTC(y, m - 1, d) - VISURA_VALIDITA_GIORNI * MS_PER_DAY);
}
