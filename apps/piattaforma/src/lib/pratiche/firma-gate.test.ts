import { describe, it, expect } from 'vitest';
import { motivoBloccoFirma, type PraticaFirmabile } from './firma-gate';

const ok: PraticaFirmabile = {
  stato: 'PROCESSATA',
  flagSegnalata: false,
  agenziaAssegnataId: 'age-1',
};

describe('motivoBloccoFirma', () => {
  it('una pratica processata, non segnalata e assegnata è firmabile', () => {
    expect(motivoBloccoFirma(ok)).toBeNull();
  });

  it('blocca se la pratica non è ancora processata', () => {
    expect(motivoBloccoFirma({ ...ok, stato: 'ACCETTATA' })).toBe(
      'La pratica deve essere prima processata',
    );
  });

  it('blocca se la pratica è già firmata', () => {
    expect(motivoBloccoFirma({ ...ok, stato: 'FIRMATA' })).toBe(
      'La pratica deve essere prima processata',
    );
  });

  it('blocca se c\'è una segnalazione in verifica', () => {
    // Bug preesistente: prima di questo gate una pratica segnalata poteva
    // essere firmata, e la segnalazione restava appesa per sempre nella coda
    // admin (confermaAnnullamentoConPenale rifiuta le FIRMATA).
    expect(motivoBloccoFirma({ ...ok, flagSegnalata: true })).toBe(
      'Pratica con segnalazione in verifica: non puoi firmarla finché il team non ha deciso.',
    );
  });

  it('blocca se non c\'è un\'agenzia assegnata', () => {
    expect(motivoBloccoFirma({ ...ok, agenziaAssegnataId: null })).toBe(
      'Pratica senza agenzia assegnata',
    );
  });

  it('lo stato viene controllato prima della segnalazione', () => {
    // Una pratica ANNULLATA con flagSegnalata deve dire "non processata",
    // non "segnalazione in verifica": il messaggio deve descrivere il vero
    // motivo per cui l'utente non può procedere.
    expect(motivoBloccoFirma({ stato: 'ANNULLATA', flagSegnalata: true, agenziaAssegnataId: 'age-1' }))
      .toBe('La pratica deve essere prima processata');
  });
});
