/**
 * Parsing difensivo del cookie `pv_utm` (first-touch, scritto lato client alla
 * landing). Funzione PURA: nessuna dipendenza da prisma/next, così è testabile
 * in isolamento.
 *
 * Il cookie contiene `encodeURIComponent(JSON.stringify({ source, medium,
 * campaign, content }))` con solo le chiavi presenti. Qui decodifichiamo,
 * parsiamo e validiamo: accettiamo SOLO valori stringa (numeri/oggetti → null)
 * e tronchiamo a 200 caratteri per difesa. Qualsiasi errore (cookie assente,
 * JSON malformato, ecc.) ritorna tutti null senza lanciare.
 */

const MAX_LEN = 200;

export type ParsedUtm = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
};

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.slice(0, MAX_LEN);
  return trimmed.length > 0 ? trimmed : null;
}

export function parseUtmCookie(raw: string | undefined | null): ParsedUtm {
  const empty: ParsedUtm = {
    source: null,
    medium: null,
    campaign: null,
    content: null,
  };
  if (!raw) return empty;

  try {
    const decoded = decodeURIComponent(raw);
    const obj: unknown = JSON.parse(decoded);
    if (typeof obj !== 'object' || obj === null) return empty;
    const rec = obj as Record<string, unknown>;
    return {
      source: clean(rec.source),
      medium: clean(rec.medium),
      campaign: clean(rec.campaign),
      content: clean(rec.content),
    };
  } catch {
    return empty;
  }
}
