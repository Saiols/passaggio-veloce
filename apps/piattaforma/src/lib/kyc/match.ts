const LEGAL_FORMS = [
  'SRLS', 'SRL', 'SPA', 'SAPA', 'SNC', 'SAS', 'SS', 'SCARL', 'SOC COOP', 'COOP',
];

/** Upper, rimuove accenti, tiene solo lettere/spazi, spazi singoli. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeCompanyName(s: string): string {
  // Remove dots so "S.R.L." → "SRL" before normalization, enabling legal-form matching.
  const stripped = s.replace(/\./g, '');
  let n = normalizeName(stripped);
  for (const form of LEGAL_FORMS) {
    n = n.replace(new RegExp(`\\b${form}\\b`, 'g'), '');
  }
  return n.trim().replace(/\s+/g, ' ');
}

export function normalizeCf(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizePiva(s: string): string {
  return s.replace(/\D/g, '');
}

/** Validazione check digit del codice fiscale persona fisica (16 char). */
export function isValidCodiceFiscale(cf: string): boolean {
  const c = normalizeCf(cf);
  if (!/^[A-Z0-9]{16}$/.test(c)) return false;
  const odd: Record<string, number> = {
    '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
    A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
    N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
  };
  const evenVal = (ch: string): number =>
    /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 65;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = c[i]!;
    sum += i % 2 === 0 ? odd[ch]! : evenVal(ch);
  }
  return String.fromCharCode(65 + (sum % 26)) === c[15];
}

/** Levenshtein distance (per tollerare refusi OCR su singoli token). */
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[m]![n]!;
}

function tokenSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  const ratio = 1 - lev(a, b) / Math.max(a.length, b.length);
  return ratio >= 0.8;
}

/** Token-set: ogni token del nome più corto ha un token simile nell'altro. */
export function nameMatches(a: string, b: string): boolean {
  const ta = normalizeName(a).split(' ').filter(Boolean);
  const tb = normalizeName(b).split(' ').filter(Boolean);
  if (!ta.length || !tb.length) return false;
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return shorter.every((t) => longer.some((u) => tokenSimilar(t, u)));
}

export function companyMatches(
  visura: { denominazione?: string; partitaIva?: string },
  step2: { denominazione: string; partitaIva: string },
): boolean {
  if (visura.partitaIva && normalizePiva(visura.partitaIva) === normalizePiva(step2.partitaIva)) {
    return true;
  }
  if (visura.denominazione &&
      normalizeCompanyName(visura.denominazione) === normalizeCompanyName(step2.denominazione)) {
    return true;
  }
  return false;
}
