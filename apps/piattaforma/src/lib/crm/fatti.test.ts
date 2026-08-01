import { describe, it, expect } from 'vitest';
import { statoFattuale, timelineFatti } from './fatti';

const vuoto = {
  createdAt: new Date('2026-01-01'),
  linkInviato: false,
  linkInviatoAt: null,
  linkAperto: false,
  linkApertoAt: null,
  iscrizioneInit: false,
  iscrizioneComp: false,
  iscrizioneAt: null,
  primaPratica: false,
  primaPraticaAt: null,
  praticheTotal: 0,
  matchedAt: null,
};

describe('statoFattuale', () => {
  it('nessun flag → S0', () => {
    expect(statoFattuale(vuoto).codice).toBe('S0');
  });
  it('link inviato → S4 con la sua data', () => {
    const at = new Date('2026-02-01');
    const r = statoFattuale({ ...vuoto, linkInviato: true, linkInviatoAt: at });
    expect(r.codice).toBe('S4');
    expect(r.at).toEqual(at);
  });
  it('link aperto batte link inviato → S5', () => {
    expect(statoFattuale({ ...vuoto, linkInviato: true, linkAperto: true }).codice).toBe('S5');
  });
  it('iscrizione completa → S7', () => {
    expect(statoFattuale({ ...vuoto, iscrizioneComp: true }).codice).toBe('S7');
  });
  it('prima pratica → S8, ≥2 pratiche → S9', () => {
    expect(statoFattuale({ ...vuoto, primaPratica: true, praticheTotal: 1 }).codice).toBe('S8');
    expect(statoFattuale({ ...vuoto, primaPratica: true, praticheTotal: 3 }).codice).toBe('S9');
  });
});

describe('timelineFatti', () => {
  it('unisce timestamp e chiamate, ordina per data crescente', () => {
    const c = {
      ...vuoto,
      linkInviato: true,
      linkInviatoAt: new Date('2026-01-05'),
      iscrizioneComp: true,
      iscrizioneAt: new Date('2026-01-20'),
    };
    const calls = [{ startedAt: new Date('2026-01-10'), esito: 'INTERESSATO' }];
    const t = timelineFatti(c, calls);
    expect(t.map((e) => e.at.toISOString())).toEqual([
      new Date('2026-01-01').toISOString(), // creato
      new Date('2026-01-05').toISOString(), // email inviata
      new Date('2026-01-10').toISOString(), // chiamata
      new Date('2026-01-20').toISOString(), // registrazione
    ]);
  });
  it('salta i timestamp null', () => {
    const t = timelineFatti(vuoto, []);
    expect(t).toHaveLength(1); // solo "Contatto creato"
  });
});
