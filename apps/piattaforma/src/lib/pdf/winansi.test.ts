import { describe, it, expect } from 'vitest';
import { winAnsiSafe, isWinAnsiEncodable } from './winansi';

/** Ogni code point della stringa e' codificabile in WinAnsi/CP1252? */
function tuttoEncodabile(s: string): boolean {
  for (const ch of s) {
    if (!isWinAnsiEncodable(ch.codePointAt(0) ?? 0)) return false;
  }
  return true;
}

describe('winAnsiSafe', () => {
  it('lascia invariato ASCII e Latin-1 (accenti italiani, c cediglia)', () => {
    const s = "Società à è é ì ò ù ç ñ - Via Garibaldi 12/A";
    expect(winAnsiSafe(s)).toBe(s);
  });

  it('preserva i caratteri "alti" CP1252 (Euro, virgolette curve, em dash)', () => {
    const s = String.fromCodePoint(0x20ac, 0x201c, 0x201d, 0x2014, 0x2122); // EUR " " — TM
    expect(winAnsiSafe(s)).toBe(s);
  });

  it('normalizza lo spazio stretto U+202F (valuta ICU) a spazio normale', () => {
    const s = '1.234,56' + String.fromCodePoint(0x202f) + String.fromCodePoint(0x20ac);
    expect(winAnsiSafe(s)).toBe('1.234,56 ' + String.fromCodePoint(0x20ac));
  });

  it('rimuove gli zero-width e normalizza gli hyphen non-CP1252', () => {
    const s = 'AB' + String.fromCodePoint(0x200b) + 'CD' + String.fromCodePoint(0x2011) + 'EF';
    expect(winAnsiSafe(s)).toBe('ABCD-EF');
  });

  it('translittera cirillico/greco/turco e non lascia mai char fuori CP1252', () => {
    const inputs = [
      'Авто Сервис Москва',
      'Çağrı İstanbul',
      'Ω≈÷ 中央区',
      String.fromCodePoint(0x1f600), // emoji
    ];
    for (const s of inputs) {
      const safe = winAnsiSafe(s);
      expect(tuttoEncodabile(safe)).toBe(true);
    }
  });

  it('non lascia mai stringa vuota collassare a errore (fallback ?)', () => {
    expect(winAnsiSafe(String.fromCodePoint(0x1f4a9))).toBe('?');
  });
});
