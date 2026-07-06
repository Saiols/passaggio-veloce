import { describe, it, expect } from 'vitest';
import {
  statoExtra,
  tipoSegnalazioneLabel,
  motivoPenaleSegnalazione,
  type StatoExtraInput,
} from './stato-extra';

// Pratica "sana", nessun trattamento extra: accettata, mai segnalata.
const base: StatoExtraInput = {
  stato: 'ACCETTATA',
  flagSegnalata: false,
  segnalazioneStato: null,
  tipoSegnalazione: null,
  notaSegnalazione: null,
  penaleAddebitatoCent: null,
  revisioneCompletata: false,
  richiedeRevisioneManuale: false,
};

describe('statoExtra — in revisione (segnalazione RICEVUTA)', () => {
  it('flagSegnalata + RICEVUTA → IN_REVISIONE con tipo e nota', () => {
    const r = statoExtra({
      ...base,
      stato: 'ACCETTATA',
      flagSegnalata: true,
      segnalazioneStato: 'RICEVUTA',
      tipoSegnalazione: 'FERMO_AMMINISTRATIVO',
      notaSegnalazione: 'Risulta un fermo del 2023',
    });
    expect(r).toEqual({
      kind: 'IN_REVISIONE',
      tipo: 'FERMO_AMMINISTRATIVO',
      nota: 'Risulta un fermo del 2023',
    });
  });

  it('vale anche in stato PROCESSATA', () => {
    const r = statoExtra({
      ...base,
      stato: 'PROCESSATA',
      flagSegnalata: true,
      segnalazioneStato: 'RICEVUTA',
      tipoSegnalazione: 'IPOTECA',
    });
    expect(r?.kind).toBe('IN_REVISIONE');
  });

  it('ha precedenza sullo stato: RICEVUTA vince', () => {
    const r = statoExtra({
      ...base,
      flagSegnalata: true,
      segnalazioneStato: 'RICEVUTA',
    });
    expect(r?.kind).toBe('IN_REVISIONE');
  });

  it('RICEVUTA ma flagSegnalata=false → nessun trattamento', () => {
    const r = statoExtra({ ...base, flagSegnalata: false, segnalazioneStato: 'RICEVUTA' });
    expect(r).toBeNull();
  });
});

describe('statoExtra — annullata dal team', () => {
  it('ANNULLATA + segnalazione CONFERMATA → SEGNALAZIONE con tipo, nota, penale', () => {
    const r = statoExtra({
      ...base,
      stato: 'ANNULLATA',
      flagSegnalata: true,
      segnalazioneStato: 'CONFERMATA',
      tipoSegnalazione: 'FERMO_AMMINISTRATIVO',
      notaSegnalazione: 'Fermo confermato',
      penaleAddebitatoCent: 2500,
    });
    expect(r).toEqual({
      kind: 'ANNULLATA_TEAM',
      origine: 'SEGNALAZIONE',
      tipo: 'FERMO_AMMINISTRATIVO',
      nota: 'Fermo confermato',
      penaleCent: 2500,
    });
  });

  it('ANNULLATA da revisione documentale (completata + ancora richiesta) → REVISIONE', () => {
    const r = statoExtra({
      ...base,
      stato: 'ANNULLATA',
      revisioneCompletata: true,
      richiedeRevisioneManuale: true,
    });
    expect(r).toEqual({ kind: 'ANNULLATA_TEAM', origine: 'REVISIONE' });
  });
});

describe('statoExtra — nessun trattamento (grigio)', () => {
  it('auto-annullo del broker (nessuna segnalazione, nessuna revisione) → null', () => {
    const r = statoExtra({ ...base, stato: 'ANNULLATA' });
    expect(r).toBeNull();
  });

  it('segnalazione RESPINTA → null (torna live, flag azzerato)', () => {
    const r = statoExtra({
      ...base,
      stato: 'ACCETTATA',
      flagSegnalata: false,
      segnalazioneStato: 'RESPINTA',
    });
    expect(r).toBeNull();
  });

  it('revisione RISOLTA poi auto-annullo (richiedeRevisioneManuale=false) → null', () => {
    const r = statoExtra({
      ...base,
      stato: 'ANNULLATA',
      revisioneCompletata: true,
      richiedeRevisioneManuale: false,
    });
    expect(r).toBeNull();
  });

  it('pratica accettata normale → null', () => {
    expect(statoExtra(base)).toBeNull();
  });
});

describe('tipoSegnalazioneLabel', () => {
  it('mappa tutti i tipi in italiano', () => {
    expect(tipoSegnalazioneLabel('FERMO_AMMINISTRATIVO')).toBe('Fermo amministrativo');
    expect(tipoSegnalazioneLabel('IPOTECA')).toBe('Ipoteca');
    expect(tipoSegnalazioneLabel('DOCUMENTO_NON_VALIDO')).toBe('Documento non valido');
    expect(tipoSegnalazioneLabel('ALTRO')).toBe('Altro');
  });
});

describe('motivoPenaleSegnalazione', () => {
  it('esplicita il motivo della penale in linguaggio naturale', () => {
    expect(motivoPenaleSegnalazione('FERMO_AMMINISTRATIVO')).toBe(
      'Segnalazione per fermo amministrativo',
    );
    expect(motivoPenaleSegnalazione('IPOTECA')).toBe('Segnalazione per ipoteca');
    expect(motivoPenaleSegnalazione('DOCUMENTO_NON_VALIDO')).toBe(
      'Segnalazione per documento non valido',
    );
    expect(motivoPenaleSegnalazione('ALTRO')).toBe('Segnalazione per altro');
  });
});
