import { describe, it, expect } from 'vitest';
import { etichettaSede, etichetteSediUniche } from './etichetta-sede';
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

describe('etichettaSede — non deve mai divergere da etichetteSediUniche in caso di collisione', () => {
  it('due sedi omonime ("Filiale") in due città diverse: la card mostra la STESSA forma disambiguata del selettore, mai il nome nudo', () => {
    // Prima del fix: la card calcolava l'etichetta da sola con `labelSede`,
    // ignara delle altre sedi, e mostrava "Filiale" (ambiguo) mentre il
    // selettore, per la stessa sede, mostrava "Filiale — Milano".
    const filialeMilano: SedeRef = { id: 'f1', nome: 'Filiale', type: 'DEALER', citta: 'Milano' };
    const filialeRoma: SedeRef = { id: 'f2', nome: 'Filiale', type: 'DEALER', citta: 'Roma' };
    const accessibleSedi = [filialeMilano, filialeRoma];

    const etichette = etichetteSediUniche(accessibleSedi, AZIENDA);
    const labelSelettoreMilano = etichette.find((e) => e.id === 'f1')!.label;

    const labelCardMilano = etichettaSede({
      currentSede: { kind: 'ONE', sede: filialeMilano },
      accessibleSedi,
      ragioneSociale: AZIENDA,
    });

    expect(labelCardMilano).toBe(labelSelettoreMilano);
    expect(labelCardMilano).toBe('Filiale — Milano');
  });
});

describe('etichetteSediUniche — selettore (menu con tutte le sedi viste insieme)', () => {
  it('caso normale: nessuna collisione, ciascuna sede la sua etichetta — stessa regola della card', () => {
    // Lo stesso identico input di etichettaSede sopra: il selettore non deve
    // dire una cosa diversa dalla card per la stessa sede.
    expect(etichetteSediUniche([SEDE_OMONIMA, SEDE_PROPRIA], AZIENDA)).toEqual([
      { id: 's1', label: 'Buccinasco' },
      { id: 's2', label: 'Dimensione Auto Corsico' },
    ]);
  });

  it('con una sola sede l\'etichetta è quella singola, senza confronti spuri', () => {
    expect(etichetteSediUniche([SEDE_PROPRIA], AZIENDA)).toEqual([
      { id: 's2', label: 'Dimensione Auto Corsico' },
    ]);
  });

  it('due sedi che collidono sulla stessa etichetta passano alla forma disambiguante "nome — città"', () => {
    // sedeUno: il nome coincide con la ragione sociale → l'etichetta di base
    // ricade sulla città ("Milano"). sedeDue: ha per nome proprio, per
    // coincidenza, proprio "Milano", ma è a Roma. Le due etichette di base
    // collidono entrambe su "Milano": nel menu l'utente non potrebbe più
    // capire quale delle due sta scegliendo. Un selettore con due opzioni
    // identiche è rotto — qui NON deve restare tale.
    const sedeUno: SedeRef = { id: 'x1', nome: AZIENDA, type: 'DEALER', citta: 'Milano' };
    const sedeDue: SedeRef = { id: 'x2', nome: 'Milano', type: 'DEALER', citta: 'Roma' };

    const risultato = etichetteSediUniche([sedeUno, sedeDue], AZIENDA);

    expect(risultato).toEqual([
      { id: 'x1', label: `${AZIENDA} — Milano` },
      { id: 'x2', label: 'Milano — Roma' },
    ]);
    // Difesa esplicita contro la regressione che questo test previene: le due
    // etichette finali non devono mai tornare a coincidere.
    expect(risultato[0]!.label).not.toBe(risultato[1]!.label);
  });

  it('due sedi con stesso nome e stessa città: la forma "nome — città" non basta, serve un\'ulteriore disambiguazione', () => {
    // Qui la collisione nasce proprio da nome+città uguali: la forma
    // disambiguante "nome — città" produce la STESSA stringa per entrambe.
    const sedeUno: SedeRef = { id: 'y1', nome: 'Filiale', type: 'DEALER', citta: 'Milano' };
    const sedeDue: SedeRef = { id: 'y2', nome: 'Filiale', type: 'DEALER', citta: 'Milano' };

    const risultato = etichetteSediUniche([sedeUno, sedeDue], AZIENDA);

    const labels = risultato.map((r) => r.label);
    // L'invariante: le label sono sempre tutte distinte, comunque siano fatti i dati.
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('due sedi entrambe omonime della ragione sociale, nella stessa città: idem, serve disambiguazione oltre "nome — città"', () => {
    // Caso citato testualmente nel commento della funzione: due sedi nella
    // stessa città, entrambe col nome uguale alla ragione sociale → la label
    // di base ricade sulla città per entrambe ("Milano"), la forma
    // disambiguante "nome — città" produce ANCH'ESSA la stessa stringa
    // ("Auto Srl — Milano") per entrambe.
    const sedeUno: SedeRef = { id: 'z1', nome: AZIENDA, type: 'DEALER', citta: 'Milano' };
    const sedeDue: SedeRef = { id: 'z2', nome: AZIENDA, type: 'DEALER', citta: 'Milano' };

    const risultato = etichetteSediUniche([sedeUno, sedeDue], AZIENDA);

    const labels = risultato.map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
