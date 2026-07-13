import { describe, it, expect } from 'vitest';
import {
  ART_APPROVAZIONE_SPECIFICA,
  CLAUSOLE_VESSATORIE,
  DESCRIZIONI_VESSATORIE,
  TERMS_VERSION,
  elencoClausoleVessatorie,
} from './clausole-vessatorie';

describe('clausole vessatorie', () => {
  it('elenca le clausole approvate specificamente ex 1341/1342', () => {
    expect([...CLAUSOLE_VESSATORIE]).toEqual([3, 5, 7, 8, 10, 11, 12, 13, 17]);
  });

  it("l'articolo di approvazione specifica è il 18", () => {
    expect(ART_APPROVAZIONE_SPECIFICA).toBe(18);
  });

  it("nessuna clausola vessatoria coincide o supera l'articolo di approvazione", () => {
    // Un elenco che citasse se stesso (o un articolo inesistente) sarebbe un
    // contratto che si contraddice: qui si rompe il test, non il contratto.
    for (const n of CLAUSOLE_VESSATORIE) {
      expect(n).toBeLessThan(ART_APPROVAZIONE_SPECIFICA);
      expect(n).toBeGreaterThan(0);
    }
  });

  it("l'elenco è ordinato e senza duplicati", () => {
    const arr = [...CLAUSOLE_VESSATORIE];
    expect(arr).toEqual([...new Set(arr)].sort((a, b) => a - b));
  });

  it('rende l\'elenco come stringa leggibile per la checkbox', () => {
    expect(elencoClausoleVessatorie()).toBe('3, 5, 7, 8, 10, 11, 12, 13, 17');
  });

  it('la versione dei Termini è una data ISO', () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('le descrizioni coprono esattamente CLAUSOLE_VESSATORIE (né in meno né in più)', () => {
    // Se manca una chiave, `app/termini/page.tsx` renderizza `undefined` per
    // quella clausola. Se ne avanza una, è la descrizione di una clausola che
    // non è (più) vessatoria: un fossile di una vecchia numerazione. Nessuno
    // dei due casi va bene, e nessun test precedente lo catturava — solo
    // l'occhio, prima di questo test.
    const chiaviAttese = [...CLAUSOLE_VESSATORIE].sort((a, b) => a - b);
    const chiaviDescrizioni = Object.keys(DESCRIZIONI_VESSATORIE)
      .map(Number)
      .sort((a, b) => a - b);
    expect(chiaviDescrizioni).toEqual(chiaviAttese);
  });
});
