import { romeYmd } from '@/lib/date/rome-day';
import type { Festivo } from '@/lib/distribuzione/calendario';

/** Preavviso di default: due mesi bastano ad accorgersene con calma. */
export const GIORNI_PREAVVISO_FESTIVI = 60;

/**
 * True se nessun festivo configurato cade nei prossimi `giorni`.
 *
 * Serve a evitare il decadimento silenzioso del calendario: le date sono piene,
 * non ricorrenze, quindi a ogni cambio d'anno la lista si esaurisce e la
 * piattaforma tornerebbe ad allargare il raggio a Natale senza che nulla lo
 * segnali. Puro: il confronto è fra stringhe `YYYY-MM-DD`, che si ordinano
 * lessicograficamente, sul giorno di Roma.
 */
export function serveAggiornareFestivi(
  festivi: Festivo[],
  oggi: Date,
  giorni: number = GIORNI_PREAVVISO_FESTIVI,
): boolean {
  const [y, m, d] = romeYmd(oggi);
  const oggiKey = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const limite = new Date(Date.UTC(y, m - 1, d + giorni));
  const limiteKey = limite.toISOString().slice(0, 10);

  return !festivi.some((f) => f.data >= oggiKey && f.data <= limiteKey);
}
