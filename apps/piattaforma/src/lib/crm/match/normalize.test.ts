import { describe, it, expect } from 'vitest';
import {
  normalizeTel,
  normalizeEmail,
  normalizePiva,
  normalizeNome,
  normalizeIndirizzo,
  normalizeCitta,
  normalizeCap,
} from './normalize';

describe('normalizeTel', () => {
  it('riduce alla stessa chiave le tre scritture dello stesso fisso', () => {
    expect(normalizeTel('+39 02 447 8712')).toBe('024478712');
    expect(normalizeTel('024478712')).toBe('024478712');
    expect(normalizeTel('0039 02 4478712')).toBe('024478712');
  });

  it('toglie il prefisso 39 dai cellulari con internazionale', () => {
    expect(normalizeTel('+39 346 287 7310')).toBe('3462877310');
  });

  it('NON tocca i cellulari 39x a 10 cifre', () => {
    expect(normalizeTel('3912345678')).toBe('3912345678');
  });

  it('scarta i valori troppo corti per essere una prova', () => {
    expect(normalizeTel('N/D')).toBe('');
    expect(normalizeTel('1234567')).toBe('');
    expect(normalizeTel('')).toBe('');
    expect(normalizeTel(null)).toBe('');
  });
});

describe('normalizeEmail', () => {
  it('trim + minuscolo', () => {
    expect(normalizeEmail('  Info@Agenzia.IT ')).toBe('info@agenzia.it');
    expect(normalizeEmail(null)).toBe('');
  });
});

describe('normalizePiva', () => {
  it('tiene solo le cifre e pretende 11 caratteri', () => {
    expect(normalizePiva('IT 06199680155')).toBe('06199680155');
    expect(normalizePiva('123')).toBe('');
    expect(normalizePiva(null)).toBe('');
  });
});

describe('normalizeNome', () => {
  it('toglie forma societaria, accenti e punteggiatura', () => {
    expect(normalizeNome('Dimensione Auto Milano S.r.l.')).toBe('dimensione auto milano');
    expect(normalizeNome('Dimensione Auto Milano Srls')).toBe('dimensione auto milano');
    expect(normalizeNome("Città Auto S.p.A.")).toBe('citta auto');
  });

  it('ritorna stringa vuota se non resta nulla', () => {
    expect(normalizeNome('S.r.l.')).toBe('');
    expect(normalizeNome(null)).toBe('');
  });
});

describe('normalizeIndirizzo', () => {
  it('rende uguali indirizzo con e senza civico', () => {
    expect(normalizeIndirizzo('Via Fiume 6')).toBe('via fiume');
    expect(normalizeIndirizzo('Via Fiume')).toBe('via fiume');
    expect(normalizeIndirizzo('Via di Madonna Bianca, 3/b')).toBe('via di madonna bianca');
  });

  it('scioglie le abbreviazioni', () => {
    expect(normalizeIndirizzo('V.le Italia 19')).toBe('viale italia');
    expect(normalizeIndirizzo('P.zza Cavour')).toBe('piazza cavour');
  });

  it('non mangia i numeri che fanno parte del nome della via', () => {
    expect(normalizeIndirizzo('Via 25 Aprile')).toBe('via 25 aprile');
  });
});

describe('normalizeCitta / normalizeCap', () => {
  it('normalizza città e pretende un CAP a 5 cifre', () => {
    expect(normalizeCitta(' Trezzano sul Naviglio ')).toBe('trezzano sul naviglio');
    expect(normalizeCap('20094')).toBe('20094');
    expect(normalizeCap('209')).toBe('');
  });
});
