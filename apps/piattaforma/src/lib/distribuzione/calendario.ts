/**
 * Calendario della piattaforma: quando la distribuzione può allargare il raggio.
 *
 * Puro e browser-safe (nessun `server-only`, nessun accesso al DB): lo usano sia
 * il motore sia la validazione del form admin.
 *
 * Tutto il parsing è DIFENSIVO e fail-open: un valore malformato ricade sul
 * default di quel giorno, mai su "chiuso". Interpretare un JSON storto come
 * chiusura fermerebbe l'espansione di ogni pratica in piattaforma — una
 * conseguenza peggiore di quella di un DB irraggiungibile, che in
 * `getDistribuzioneConfig` degrada già ai default.
 */
import { parseYmd } from '@/lib/date/rome-day';
import type { GiornoSettimana } from './ore-lavorative';

/** Finestra di apertura di un singolo giorno della settimana. */
export type FasciaGiorno = { attivo: boolean; inizio: string; fine: string };

/** Giorno di chiusura della piattaforma (data piena, non ricorrenza). */
export type Festivo = { data: string; nome: string };

export type CalendarioPiattaforma = {
  orariSettimana: Record<GiornoSettimana, FasciaGiorno>;
  festivi: Festivo[];
};

/** Ordine di presentazione (lunedì-first), non l'ordine di `Date.getDay()`. */
export const GIORNI_ORDINE: readonly GiornoSettimana[] = [
  'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB', 'DOM',
];

/** Lunghezza massima dell'etichetta di un festivo. */
const NOME_FESTIVO_MAX = 60;

/**
 * Default = la configurazione oggi in produzione (LUN-VEN 09:00-19:00, weekend
 * spento). I giorni spenti hanno comunque una fascia sensata: attivarli dal
 * pannello non deve costringere a digitare anche gli orari.
 */
export const ORARI_SETTIMANA_DEFAULT: Record<GiornoSettimana, FasciaGiorno> = {
  LUN: { attivo: true, inizio: '09:00', fine: '19:00' },
  MAR: { attivo: true, inizio: '09:00', fine: '19:00' },
  MER: { attivo: true, inizio: '09:00', fine: '19:00' },
  GIO: { attivo: true, inizio: '09:00', fine: '19:00' },
  VEN: { attivo: true, inizio: '09:00', fine: '19:00' },
  SAB: { attivo: false, inizio: '09:00', fine: '13:00' },
  DOM: { attivo: false, inizio: '09:00', fine: '19:00' },
};

export const FESTIVI_DEFAULT: Festivo[] = [];

export const CALENDARIO_DEFAULT: CalendarioPiattaforma = {
  orariSettimana: ORARI_SETTIMANA_DEFAULT,
  festivi: FESTIVI_DEFAULT,
};

const RE_HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True se `v` è un orario "HH:MM" a due cifre e nei range reali. */
export function isHHMM(v: unknown): v is string {
  return typeof v === 'string' && RE_HHMM.test(v);
}

/** "09:30" → 570. Assume un valore già validato da `isHHMM`. */
export function hhmmToMinuti(s: string): number {
  const m = RE_HHMM.exec(s)!;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Una fascia è valida se ben tipata e con `fine` strettamente dopo `inizio`. */
function fasciaValida(v: unknown): v is FasciaGiorno {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  if (typeof f.attivo !== 'boolean') return false;
  if (!isHHMM(f.inizio) || !isHHMM(f.fine)) return false;
  return hhmmToMinuti(f.fine) > hhmmToMinuti(f.inizio);
}

/**
 * JSON persistito → fasce per giorno. Ogni giorno è valutato da solo: una riga
 * malformata non contamina le altre.
 */
export function parseOrariSettimana(raw: unknown): Record<GiornoSettimana, FasciaGiorno> {
  const src =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const out = {} as Record<GiornoSettimana, FasciaGiorno>;
  for (const g of GIORNI_ORDINE) {
    const v = src[g];
    out[g] = fasciaValida(v)
      ? { attivo: v.attivo, inizio: v.inizio, fine: v.fine }
      : ORARI_SETTIMANA_DEFAULT[g];
  }
  return out;
}

/**
 * JSON persistito → festivi ordinati e deduplicati. Una data impossibile viene
 * scartata da sola (`parseYmd` fa il round-trip su Date), senza invalidare la
 * lista: un errore di battitura su una riga non deve riaprire tutte le altre.
 */
export function parseFestivi(raw: unknown): Festivo[] {
  if (!Array.isArray(raw)) return [];

  const perData = new Map<string, Festivo>();
  for (const v of raw) {
    if (typeof v !== 'object' || v === null) continue;
    const f = v as Record<string, unknown>;
    if (typeof f.data !== 'string' || !parseYmd(f.data)) continue;
    if (perData.has(f.data)) continue; // prima occorrenza vince

    const nomeRaw = typeof f.nome === 'string' ? f.nome.trim() : '';
    perData.set(f.data, {
      data: f.data,
      nome: (nomeRaw || 'Festivo').slice(0, NOME_FESTIVO_MAX),
    });
  }

  return [...perData.values()].sort((a, b) => a.data.localeCompare(b.data));
}
