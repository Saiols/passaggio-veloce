import { describe, it, expect } from 'vitest';
import { etichettaSede } from './etichetta-sede';
import type { SedeRef } from './scope';

const AZIENDA = 'Dimensione Auto Milano Srls';

// Caso normale: alla registrazione la sede eredita il nome dell'azienda.
const SEDE_OMONIMA: SedeRef = {
  id: 's1',
  nome: 'Dimensione Auto Milano Srls',
  type: 'DEALER',
  citta: 'Buccinasco',
};

// Sede con nome proprio, data dall'azienda quando apre una filiale.
const SEDE_PROPRIA: SedeRef = {
  id: 's2',
  nome: 'Dimensione Auto Corsico',
  type: 'DEALER',
  citta: 'Corsico',
};

describe('etichettaSede — sede selezionata (kind ONE)', () => {
  it('col nome che ripete la ragione sociale mostra la città, non il nome', () => {
    // Altrimenti la card direbbe due volte "Dimensione Auto Milano Srls":
    // una come azienda e una come sede.
    expect(
      etichettaSede({
        currentSede: { kind: 'ONE', sede: SEDE_OMONIMA },
        accessibleSediCount: 2,
        ragioneSociale: AZIENDA,
      }),
    ).toBe('Buccinasco');
  });

  it("col nome proprio mostra il nome (è quello che l'utente ha scelto nel selettore)", () => {
    expect(
      etichettaSede({
        currentSede: { kind: 'ONE', sede: SEDE_PROPRIA },
        accessibleSediCount: 2,
        ragioneSociale: AZIENDA,
      }),
    ).toBe('Dimensione Auto Corsico');
  });
});

describe('etichettaSede — vista aggregata (kind ALL, solo il titolare)', () => {
  it('con più sedi dice "Tutte le sedi": non deve sembrare di essere su una sola', () => {
    expect(
      etichettaSede({
        currentSede: { kind: 'ALL' },
        accessibleSediCount: 2,
        ragioneSociale: AZIENDA,
      }),
    ).toBe('Tutte le sedi');
  });

  it('con UNA sola sede mostra quella sede', () => {
    // Il titolare resta in ALL finché non seleziona una sede, e con una sede
    // sola non può nemmeno farlo (il selettore compare solo da 2 sedi in su).
    // Applicare la regola alla lettera lo lascerebbe senza sede per sempre:
    // ma con una sede sola "aggregato" e "quella sede" sono la stessa cosa.
    expect(
      etichettaSede({
        currentSede: { kind: 'ALL' },
        accessibleSediCount: 1,
        ragioneSociale: AZIENDA,
        sedeUnica: SEDE_OMONIMA,
      }),
    ).toBe('Buccinasco');
  });

  it('con una sola sede dal nome proprio mostra quel nome', () => {
    expect(
      etichettaSede({
        currentSede: { kind: 'ALL' },
        accessibleSediCount: 1,
        ragioneSociale: AZIENDA,
        sedeUnica: SEDE_PROPRIA,
      }),
    ).toBe('Dimensione Auto Corsico');
  });
});

describe('etichettaSede — nessuna sede', () => {
  it('senza sede corrente non mostra nulla (staff di piattaforma)', () => {
    expect(
      etichettaSede({ currentSede: null, accessibleSediCount: 0, ragioneSociale: null }),
    ).toBeNull();
  });

  it('in ALL senza sedi accessibili non inventa un\'etichetta', () => {
    expect(
      etichettaSede({ currentSede: { kind: 'ALL' }, accessibleSediCount: 0, ragioneSociale: AZIENDA }),
    ).toBeNull();
  });
});
