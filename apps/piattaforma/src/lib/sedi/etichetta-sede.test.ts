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
        accessibleSedi: [SEDE_OMONIMA, SEDE_PROPRIA],
        ragioneSociale: AZIENDA,
      }),
    ).toBe('Buccinasco');
  });

  it("col nome proprio mostra il nome (è quello che l'utente ha scelto nel selettore)", () => {
    expect(
      etichettaSede({
        currentSede: { kind: 'ONE', sede: SEDE_PROPRIA },
        accessibleSedi: [SEDE_OMONIMA, SEDE_PROPRIA],
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
        accessibleSedi: [SEDE_OMONIMA, SEDE_PROPRIA],
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
        accessibleSedi: [SEDE_OMONIMA],
        ragioneSociale: AZIENDA,
      }),
    ).toBe('Buccinasco');
  });

  it('con una sola sede dal nome proprio mostra quel nome', () => {
    expect(
      etichettaSede({
        currentSede: { kind: 'ALL' },
        accessibleSedi: [SEDE_PROPRIA],
        ragioneSociale: AZIENDA,
      }),
    ).toBe('Dimensione Auto Corsico');
  });

  it('con ALL e una sola sede accessibile è impossibile ottenere "Tutte le sedi": non esiste più un secondo parametro da dimenticare, la lista è l\'unica fonte di verità', () => {
    // Col vecchio design bastava passare accessibleSediCount: 1 e dimenticare
    // sedeUnica per ricadere in silenzio su "Tutte le sedi". Ora la lunghezza
    // dell'array è l'unica fonte di verità: non c'è modo di passare un
    // conteggio incoerente con le sedi elencate.
    const risultato = etichettaSede({
      currentSede: { kind: 'ALL' },
      accessibleSedi: [SEDE_PROPRIA],
      ragioneSociale: AZIENDA,
    });
    expect(risultato).not.toBe('Tutte le sedi');
    expect(risultato).toBe('Dimensione Auto Corsico');
  });
});

describe('etichettaSede — nessuna sede', () => {
  it('senza sede corrente non mostra nulla (staff di piattaforma)', () => {
    expect(etichettaSede({ currentSede: null, accessibleSedi: [], ragioneSociale: null })).toBeNull();
  });

  it('in ALL senza sedi accessibili non inventa un\'etichetta', () => {
    expect(
      etichettaSede({ currentSede: { kind: 'ALL' }, accessibleSedi: [], ragioneSociale: AZIENDA }),
    ).toBeNull();
  });
});
