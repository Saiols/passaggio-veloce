/**
 * Rende una stringa codificabile dallo StandardFont di pdf-lib (Helvetica), che
 * supporta SOLO il repertorio WinAnsi/CP1252. Un carattere fuori da CP1252
 * (cirillico, greco, CJK, lettere turche, spazi/trattini "tipografici", ecc.) fa
 * lanciare `drawText` con «WinAnsi cannot encode "X"» => 500 sul download PDF.
 *
 * Strategia: alcuni offensori comuni (spazi stretti, trattini, zero-width)
 * hanno una resa ASCII sensata; il resto, se non rappresentabile in CP1252,
 * viene degradato via NFKD (es. lettere accentate esotiche -> base latina) e
 * infine sostituito con '?'. E' una copia di cortesia leggibile: meglio un nome
 * traslitterato che un documento che non si scarica.
 *
 * Sorgente volutamente in puro ASCII (code point numerici) per non dipendere
 * dall'encoding del file: i caratteri "invisibili" si gestiscono per numero.
 */

// I 27 caratteri "alti" di CP1252 (byte 0x80-0x9F): Euro, virgolette curve,
// en/em dash, trademark, OE/oe, S/Z/Y con caron/dieresi, ecc. Solo questi, oltre
// ad ASCII (0x20-0x7E) e Latin-1 alto (0xA0-0xFF), sono codificabili in WinAnsi.
const CP1252_HIGH: ReadonlySet<number> = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

// Sostituzioni mirate per code point NON codificabili ma con resa ASCII ovvia.
// (en dash 0x2013 ed em dash 0x2014 sono gia' in CP1252 -> non vanno qui.)
const REPLACE: ReadonlyMap<number, string> = new Map([
  [0x2007, ' '], // figure space
  [0x2008, ' '], // punctuation space
  [0x2009, ' '], // thin space
  [0x200a, ' '], // hair space
  [0x202f, ' '], // narrow no-break space (es. valuta da ICU)
  [0x2060, ''], // word joiner
  [0xfeff, ''], // zero-width no-break space / BOM
  [0x200b, ''], // zero-width space
  [0x200c, ''], // zero-width non-joiner
  [0x200d, ''], // zero-width joiner
  [0x2010, '-'], // hyphen
  [0x2011, '-'], // non-breaking hyphen
  [0x2012, '-'], // figure dash
  [0x2212, '-'], // minus sign
]);

/** true se il code point e' codificabile in WinAnsi/CP1252. */
export function isWinAnsiEncodable(cp: number): boolean {
  if (cp >= 0x20 && cp <= 0x7e) return true; // ASCII stampabile
  if (cp >= 0xa0 && cp <= 0xff) return true; // Latin-1 alto (accentate, c cediglia...)
  return CP1252_HIGH.has(cp); // extra CP1252 (Euro, virgolette curve, dash, TM...)
}

/** Restituisce una stringa interamente codificabile in WinAnsi/CP1252. */
export function winAnsiSafe(input: string): string {
  let out = '';
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0;
    const sub = REPLACE.get(cp);
    if (sub !== undefined) {
      out += sub;
      continue;
    }
    if (isWinAnsiEncodable(cp)) {
      out += ch;
      continue;
    }
    // degrado: scompone (es. accenti) e tiene solo cio' che CP1252 sa codificare;
    // le combining marks (0x300-0x36F) non sono codificabili -> cadono qui.
    let appended = '';
    for (const c of ch.normalize('NFKD')) {
      if (isWinAnsiEncodable(c.codePointAt(0) ?? 0)) appended += c;
    }
    out += appended.length > 0 ? appended : '?';
  }
  return out;
}
