import { describe, it, expect } from 'vitest';
import { numeroDocumento, labelTipoDocumento, messaggioTroncamento, numeroGiustificativo } from './format';

describe('numeroDocumento', () => {
  it('FATTURA_PV → PV-<anno>-<5cifre>', () => {
    expect(numeroDocumento({ tipo: 'FATTURA_PV', numeroProgressivo: 7, anno: 2026 })).toBe('PV-2026-00007');
  });
  it('DOC_BROKER → PV-<id4>-<anno>-<5cifre>', () => {
    expect(
      numeroDocumento({ tipo: 'DOC_BROKER', numeroProgressivo: 3, anno: 2026, emittenteNumeroSoggetto: 47 }),
    ).toBe('PV-0047-2026-00003');
  });
  it('NOTA_VARIAZIONE PV → NC-<anno>-<5cifre>', () => {
    expect(numeroDocumento({ tipo: 'NOTA_VARIAZIONE', numeroProgressivo: 12, anno: 2026 })).toBe('NC-2026-00012');
  });
  it('NOTA_VARIAZIONE broker → NC-<id4>-<anno>-<5cifre>', () => {
    expect(
      numeroDocumento({ tipo: 'NOTA_VARIAZIONE', numeroProgressivo: 2, anno: 2026, emittenteNumeroSoggetto: 47 }),
    ).toBe('NC-0047-2026-00002');
  });
  it('PENALE_BROKER → PN-<anno>-<5cifre>', () => {
    expect(numeroDocumento({ tipo: 'PENALE_BROKER', numeroProgressivo: 1, anno: 2026 })).toBe('PN-2026-00001');
  });
  it('PENALE_BROKER broker → PN-<id4>-<anno>-<5cifre>', () => {
    expect(
      numeroDocumento({ tipo: 'PENALE_BROKER', numeroProgressivo: 1, anno: 2026, emittenteNumeroSoggetto: 47 }),
    ).toBe('PN-0047-2026-00001');
  });
});

describe('labelTipoDocumento', () => {
  it('mappa i tipi', () => {
    expect(labelTipoDocumento('FATTURA_PV')).toBe('Fattura');
    expect(labelTipoDocumento('DOC_BROKER')).toBe('Compenso intermediazione');
    expect(labelTipoDocumento('NOTA_VARIAZIONE')).toBe('Nota di credito');
    expect(labelTipoDocumento('PENALE_BROKER')).toBe('Penale');
  });
});

describe('messaggioTroncamento (M-1)', () => {
  // /admin/fatturazione mostra al massimo 100 righe (`take: 100`, senza
  // paginazione) mentre i conteggi dei tab sono `count()` sul totale vero: con
  // più di 100 documenti che rispettano i filtri correnti, il tab dice un
  // numero e la tabella ne mostra 100 in silenzio — lo stesso difetto già
  // corretto su /admin/pratiche. Fix minimo e onesto: dichiarare il
  // troncamento, non aggiungere paginazione.
  it('totale entro il limite mostrato → nessun messaggio', () => {
    expect(messaggioTroncamento(12, 12)).toBeNull();
    expect(messaggioTroncamento(0, 0)).toBeNull();
  });

  it('totale oltre il limite mostrato → messaggio con i due numeri', () => {
    expect(messaggioTroncamento(100, 250)).toBe(
      'Mostrati i primi 100 di 250 documenti — affina i filtri per vederli tutti.',
    );
  });
});

describe('numeroGiustificativo', () => {
  it('formatta GI-<anno>-<5 cifre>', () => {
    expect(numeroGiustificativo(2026, 1)).toBe('GI-2026-00001');
    expect(numeroGiustificativo(2026, 47)).toBe('GI-2026-00047');
  });
});
