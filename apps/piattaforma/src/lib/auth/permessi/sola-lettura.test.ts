import { describe, it, expect } from 'vitest';
import { PERMESSI, type Permesso } from './catalogo';
import {
  PERMESSI_LETTURA,
  PERMESSI_SCRITTURA,
  isLettura,
  filtraSoloLettura,
} from './sola-lettura';

describe('partizione lettura/scrittura', () => {
  it('lettura e scrittura insieme coprono esattamente il catalogo', () => {
    const unione = [...PERMESSI_LETTURA, ...PERMESSI_SCRITTURA].sort();
    expect(
      unione,
      'Hai aggiunto o rimosso una chiave in catalogo.ts senza classificarla in ' +
        'sola-lettura.ts. Decidi se un utente SOSPESO deve conservarla (PERMESSI_LETTURA) ' +
        'o perderla (PERMESSI_SCRITTURA).',
    ).toEqual([...PERMESSI].sort());
  });

  it('nessuna chiave sta in entrambe le liste', () => {
    const lettura = new Set<Permesso>(PERMESSI_LETTURA);
    const doppie = PERMESSI_SCRITTURA.filter((p) => lettura.has(p));
    expect(doppie).toEqual([]);
  });

  it('le chiavi di scrittura note sono classificate come tali', () => {
    expect(isLettura('pratiche.create')).toBe(false);
    expect(isLettura('pratiche.firma')).toBe(false);
    expect(isLettura('wallet.payout')).toBe(false);
    expect(isLettura('team.permessi')).toBe(false);
  });

  it('le chiavi di lettura note sono classificate come tali', () => {
    expect(isLettura('pratiche.view')).toBe(true);
    expect(isLettura('pratiche.download')).toBe(true);
    expect(isLettura('wallet.view')).toBe(true);
    expect(isLettura('fatture.xml')).toBe(true);
  });

  it('una chiave fuori catalogo è trattata come scrittura (fail-closed)', () => {
    expect(isLettura('pratiche.tuttofare' as Permesso)).toBe(false);
  });

  it('filtraSoloLettura tiene le chiavi di lettura e scarta le altre', () => {
    const dato = new Set<Permesso>(['pratiche.view', 'pratiche.create', 'wallet.view', 'wallet.payout']);
    expect([...filtraSoloLettura(dato)].sort()).toEqual(['pratiche.view', 'wallet.view']);
  });

  it('filtraSoloLettura non muta il set in ingresso', () => {
    const dato = new Set<Permesso>(['pratiche.view', 'pratiche.create']);
    filtraSoloLettura(dato);
    expect(dato.has('pratiche.create')).toBe(true);
  });
});
