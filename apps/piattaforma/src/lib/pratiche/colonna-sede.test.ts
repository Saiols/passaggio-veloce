import { describe, it, expect } from 'vitest';
import {
  mostraColonnaSede,
  filtroSede,
  nomeSedeDistintivo,
  SEDE_NON_ASSEGNATA,
} from './colonna-sede';

describe('nomeSedeDistintivo', () => {
  // Alla registrazione la sede eredita il nome dell'azienda: ripeterlo accanto
  // alla colonna Agenzia (che mostra la stessa stringa) non aggiunge nulla.
  it('nome uguale alla ragione sociale → null, non c\'è nulla da distinguere', () => {
    expect(nomeSedeDistintivo('ROSSI SRL', 'ROSSI SRL')).toBeNull();
  });

  it('ignora spazi e maiuscole nel confronto', () => {
    expect(nomeSedeDistintivo('  rossi srl ', 'ROSSI SRL')).toBeNull();
  });

  it('nome proprio della filiale → si mostra', () => {
    expect(nomeSedeDistintivo('Filiale Nord', 'ROSSI SRL')).toBe('Filiale Nord');
  });

  it('restituisce il nome originale, non quello normalizzato', () => {
    expect(nomeSedeDistintivo('  Filiale Nord  ', 'ROSSI SRL')).toBe('  Filiale Nord  ');
  });

  it('ragione sociale assente → il nome resta distintivo', () => {
    expect(nomeSedeDistintivo('Filiale Nord', null)).toBe('Filiale Nord');
    expect(nomeSedeDistintivo('Filiale Nord', undefined)).toBe('Filiale Nord');
  });
});

describe('mostraColonnaSede', () => {
  it('broker: sempre — le sedi agenzia variano riga per riga', () => {
    expect(mostraColonnaSede({ companyType: 'DEALER', scopeIds: ['s1'] })).toBe(true);
    expect(mostraColonnaSede({ companyType: 'DEALER', scopeIds: ['s1', 's2'] })).toBe(true);
  });

  it('agenzia con più sedi in vista aggregata: sì', () => {
    expect(mostraColonnaSede({ companyType: 'AGENZIA', scopeIds: ['s1', 's2'] })).toBe(true);
  });

  it('agenzia su una sola sede (admin di sede, operatore, owner mono-sede): no', () => {
    expect(mostraColonnaSede({ companyType: 'AGENZIA', scopeIds: ['s1'] })).toBe(false);
  });

  it('agenzia senza sedi accessibili: no', () => {
    expect(mostraColonnaSede({ companyType: 'AGENZIA', scopeIds: [] })).toBe(false);
  });
});

describe('filtroSede — selezione assente o non ammessa', () => {
  const base = { opzioniIds: ['s1'], scopeIds: null, consentiNonAssegnata: true };

  it('nessuna selezione → nessun filtro', () => {
    expect(filtroSede({ ...base, selezione: undefined })).toEqual({ tipo: 'nessuno' });
    expect(filtroSede({ ...base, selezione: '' })).toEqual({ tipo: 'nessuno' });
  });

  it('id fuori dalle opzioni ammesse → ignorato, non applicato alla cieca', () => {
    expect(filtroSede({ ...base, selezione: 'sede-di-un-altra-azienda' })).toEqual({
      tipo: 'nessuno',
    });
  });
});

describe('filtroSede — broker e admin (nessuno scope sede sulle pratiche)', () => {
  const base = { opzioniIds: ['s1', 's2'], scopeIds: null, consentiNonAssegnata: true };

  it('id ammesso → filtra su quella sede', () => {
    expect(filtroSede({ ...base, selezione: 's2' })).toEqual({ tipo: 'sede', sedeIds: ['s2'] });
  });

  it('"nessuna" → pratiche senza sede assegnata', () => {
    expect(filtroSede({ ...base, selezione: SEDE_NON_ASSEGNATA })).toEqual({
      tipo: 'nonAssegnata',
    });
  });
});

describe('filtroSede — agenzia (il filtro restringe lo scope, non lo sostituisce)', () => {
  const base = { opzioniIds: ['s1', 's2'], consentiNonAssegnata: false };

  it('sede nello scope → filtra su quella sede', () => {
    expect(filtroSede({ ...base, selezione: 's2', scopeIds: ['s1', 's2'] })).toEqual({
      tipo: 'sede',
      sedeIds: ['s2'],
    });
  });

  it('sede fuori dallo scope → lista vuota, mai dati di un altro scope', () => {
    expect(filtroSede({ ...base, selezione: 's2', scopeIds: ['s1'] })).toEqual({
      tipo: 'sede',
      sedeIds: [],
    });
  });

  it('"nessuna" non è ammessa: sovrascriverebbe il vincolo di scope', () => {
    expect(
      filtroSede({ ...base, selezione: SEDE_NON_ASSEGNATA, scopeIds: ['s1', 's2'] }),
    ).toEqual({ tipo: 'nessuno' });
  });
});
