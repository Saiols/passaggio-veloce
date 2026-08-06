import { describe, it, expect } from 'vitest';
import { statoFattuale, timelineFatti } from './fatti';

const vuoto = {
  status: 'S0',
  createdAt: new Date('2026-01-01'),
  lastContactAt: null,
  linkInviato: false,
  linkInviatoAt: null,
  linkAperto: false,
  linkApertoAt: null,
  mailApertaAt: null,
  iscrizioneInit: false,
  iscrizioneInitAt: null,
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

  it('status "Non risponde" (S1) impostato a mano compare anche senza flag', () => {
    const at = new Date('2026-03-01');
    const r = statoFattuale({ ...vuoto, status: 'S1', lastContactAt: at });
    expect(r.codice).toBe('S1');
    expect(r.label).toBe('Non risponde');
    expect(r.at).toEqual(at); // usa l'ultimo contatto
  });

  it('status "Non risponde" ma un flag più avanzato (link aperto) → vince il flag (S5)', () => {
    expect(statoFattuale({ ...vuoto, status: 'S1', linkAperto: true }).codice).toBe('S5');
  });

  it('status fattuale avanzato a mano (S7) senza flag → S7', () => {
    expect(statoFattuale({ ...vuoto, status: 'S7' }).codice).toBe('S7');
  });

  it('status legacy fuori scala (S2/S3/S11) è ignorato: contano i flag', () => {
    expect(statoFattuale({ ...vuoto, status: 'S3', linkInviato: true }).codice).toBe('S4');
    expect(statoFattuale({ ...vuoto, status: 'S11' }).codice).toBe('S0');
  });

  it('S6 riporta la data di iscrizione INIZIATA, non quella di completamento', () => {
    const at = new Date('2026-08-01T10:00:00Z');
    const r = statoFattuale({
      ...vuoto,
      linkInviato: true,
      linkAperto: true,
      iscrizioneInit: true,
      iscrizioneInitAt: at,
    });
    expect(r.codice).toBe('S6');
    expect(r.at).toEqual(at);
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

  // Il pannello Fatti mostra queste due righe (RigaReferto "Mail aperta" e
  // "Iscrizione iniziata") accanto alla timeline: se la timeline non le
  // includesse, si contraddirebbe col referto a fianco.
  it('include mail aperta e iscrizione iniziata, in ordine cronologico', () => {
    const c = {
      ...vuoto,
      mailApertaAt: new Date('2026-01-06'),
      iscrizioneInitAt: new Date('2026-01-08'),
    };
    const t = timelineFatti(c, []);
    expect(t.map((e) => e.label)).toEqual([
      'Contatto creato',
      'Mail aperta',
      'Iscrizione iniziata',
    ]);
  });
});
