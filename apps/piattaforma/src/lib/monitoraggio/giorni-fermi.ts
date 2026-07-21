import type { PraticaStato } from '@pv/db';
import { romeYmd } from '@/lib/date/rome-day';

/**
 * Giorni di CALENDARIO (fuso Europe/Rome) trascorsi da `from` a `now`. Conta i
 * confini di mezzanotte a Roma, non i periodi di 24h: una pratica accettata ieri
 * sera è "1 giorno" anche se sono passate 14 ore. 0 lo stesso giorno; null se
 * `from` è null.
 */
export function giorniCalendarioTrascorsi(from: Date | null, now: Date): number | null {
  if (!from) return null;
  const [y1, m1, d1] = romeYmd(from);
  const [y2, m2, d2] = romeYmd(now);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export type FermaLevel = 'ok' | 'warn' | 'urgent';

/** Rosso a partire da 3 giorni (spec); ambra come pre-avviso soft a 2. */
export const FERMA_SOGLIA_ROSSO = 3;
export const FERMA_SOGLIA_AMBRA = 2;

export function fermaLevel(giorni: number | null): FermaLevel {
  if (giorni === null) return 'ok';
  if (giorni >= FERMA_SOGLIA_ROSSO) return 'urgent';
  if (giorni >= FERMA_SOGLIA_AMBRA) return 'warn';
  return 'ok';
}

/**
 * Categorie della pagina di monitoraggio. Distribuzione v2 (raggio
 * incrementale) ha introdotto un secondo modo di essere "ferma", diverso dal
 * caso storico:
 *  - `ACCETTATA_FERMA`: un'agenzia ha accettato ma non lavora la pratica
 *    (`stato = ACCETTATA`, `processataAt = null`) — c'è un'agenzia da revocare.
 *  - `ZONA_NON_COPERTA`: il motore ha esaurito l'espansione del raggio senza
 *    trovare nessuna agenzia in zona (`stato = IN_DISTRIBUZIONE`,
 *    `zonaNonCopertaAt` valorizzato) — non c'è nessuna agenzia da sganciare,
 *    serve un intervento manuale (contattare un'agenzia fuori raggio, alzare
 *    il raggio massimo di config, ecc.).
 *
 * Le due categorie non si sovrappongono mai: `zonaNonCopertaAt` vive solo su
 * pratiche `IN_DISTRIBUZIONE` (lib/distribuzione/tick.ts), mai su `ACCETTATA`.
 */
export type CategoriaMonitoraggio = 'ACCETTATA_FERMA' | 'ZONA_NON_COPERTA';

export const CATEGORIA_MONITORAGGIO_LABEL: Record<CategoriaMonitoraggio, string> = {
  ACCETTATA_FERMA: 'Accettata, ferma',
  ZONA_NON_COPERTA: 'Zona non coperta',
};

/**
 * Classifica una pratica candidata alla pagina di monitoraggio. `null` se non
 * rientra in nessuna delle due categorie: la query a monte (`page.tsx`) filtra
 * già solo le pratiche pertinenti, ma questa funzione resta corretta anche se
 * il chiamante cambia (difensiva, niente `!` a valle).
 */
export function categoriaMonitoraggio(p: {
  stato: PraticaStato;
  processataAt: Date | null;
  zonaNonCopertaAt: Date | null;
}): CategoriaMonitoraggio | null {
  if (p.stato === 'ACCETTATA' && p.processataAt === null) return 'ACCETTATA_FERMA';
  if (p.stato === 'IN_DISTRIBUZIONE' && p.zonaNonCopertaAt !== null) return 'ZONA_NON_COPERTA';
  return null;
}

/**
 * Data da cui contare i giorni fermi, coerente con la categoria: per
 * `ACCETTATA_FERMA` è da quando l'agenzia ha accettato (comportamento
 * invariato); per `ZONA_NON_COPERTA` è da quando il motore ha dichiarato la
 * zona scoperta (l'istante in cui l'espansione si è fermata).
 */
export function dataFermaDa(
  p: { accettataAt: Date | null; zonaNonCopertaAt: Date | null },
  categoria: CategoriaMonitoraggio,
): Date | null {
  return categoria === 'ACCETTATA_FERMA' ? p.accettataAt : p.zonaNonCopertaAt;
}
