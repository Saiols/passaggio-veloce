/**
 * Normalizzazione dei campi con cui si riconosce un'azienda registrata dentro
 * la lista CRM. Modulo PURO: niente server-only, niente Prisma.
 *
 * È la FONTE UNICA. Prima esistevano due `normalizePhone` divergenti
 * (`lib/crm/util.ts` e `lib/crm/phone.ts`) e il match telefonico non scattava
 * mai, perché il numero normalizzato veniva confrontato con `CrmContact.tel`
 * grezzo ("+39 02 447 8712").
 *
 * Convenzione: `''` significa "non utilizzabile come chiave" e non deve MAI
 * essere considerato uguale a un altro `''`.
 */

const SOLO_CIFRE = /\D/g;

/**
 * Telefono → chiave. Solo cifre, prefisso internazionale italiano rimosso:
 * '+39 02 447 8712', '0039 02 4478712' e '02 4478712' danno '024478712'.
 * Il taglio del '39' iniziale scatta solo oltre le 10 cifre, così i cellulari
 * 39x (391/392/393…) restano interi. Sotto le 8 cifre la chiave è troppo debole
 * per fare da prova d'identità (in lista ci sono 19 righe 'N/D').
 */
export function normalizeTel(raw: string | null | undefined): string {
  if (!raw) return '';
  let d = raw.replace(SOLO_CIFRE, '');
  if (d.startsWith('0039')) d = d.slice(4);
  else if (d.startsWith('39') && d.length > 10) d = d.slice(2);
  return d.length >= 8 ? d : '';
}

export function normalizeEmail(raw: string | null | undefined): string {
  return raw ? raw.trim().toLowerCase() : '';
}

/** P.IVA → 11 cifre, altrimenti nessuna chiave. */
export function normalizePiva(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = raw.replace(SOLO_CIFRE, '');
  return d.length === 11 ? d : '';
}

/** Minuscolo, accenti sciolti, trim. Base comune degli altri normalizzatori. */
function base(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

const FORME_SOCIETARIE =
  /\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|soc(?:ieta)?\s*coop(?:erativa)?|s\.?c\.?)\b/g;

const PUNTEGGIATURA = /[^a-z0-9]+/g;

/** Ragione sociale → chiave: senza forma societaria né punteggiatura. */
export function normalizeNome(raw: string | null | undefined): string {
  return base(raw)
    .replace(FORME_SOCIETARIE, ' ')
    .replace(PUNTEGGIATURA, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const ABBREVIAZIONI: Array<[RegExp, string]> = [
  [/\bv\.?le\b/g, 'viale'],
  [/\bp\.?zz?a\b/g, 'piazza'],
  [/\bc\.?so\b/g, 'corso'],
  [/\bv\.\s*/g, 'via '],
];

/**
 * Indirizzo → chiave, senza civico finale: in lista l'indirizzo è "Via Fiume 6",
 * in piattaforma via e civico sono due campi ("Via Fiume" + "6").
 */
export function normalizeIndirizzo(raw: string | null | undefined): string {
  let s = base(raw);
  for (const [re, to] of ABBREVIAZIONI) s = s.replace(re, to);
  s = s.replace(PUNTEGGIATURA, ' ').trim().replace(/\s+/g, ' ');
  // Civico finale: numero eventualmente seguito da lettera ("12 e", "3 b").
  s = s.replace(/\s+\d+(?:\s+[a-z])?$/, '');
  return s.trim();
}

export function normalizeCitta(raw: string | null | undefined): string {
  return base(raw).replace(PUNTEGGIATURA, ' ').trim().replace(/\s+/g, ' ');
}

export function normalizeCap(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = raw.replace(SOLO_CIFRE, '');
  return d.length === 5 ? d : '';
}
