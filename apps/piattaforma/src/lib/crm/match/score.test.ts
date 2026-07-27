import { describe, it, expect } from 'vitest';
import { identitaDaCompany, type CompanyGrezza } from './identita';
import { preparaContatto, valuta, type ContattoGrezzo } from './score';

const AGENZIA: CompanyGrezza = {
  id: 'c1',
  type: 'AGENZIA',
  ragioneSociale: 'AGENZIA CORSICO DI CIAVARELLA ANTONIO',
  partitaIva: '06199680155',
  email: 'info@agenziacorsico.it',
  pec: 'agenziacorsico@pec.it',
  telefono: '024478712',
  indirizzo: 'Via Fiume',
  civico: '6',
  citta: 'Corsico',
  cap: '20094',
  createdAt: new Date('2026-01-10T10:00:00Z'),
  sedi: [],
};

const contatto = (over: Partial<ContattoGrezzo> = {}) =>
  preparaContatto({
    id: 'x1',
    cat: 'AGENZIA',
    nome: 'Agenzia Corsico Pratiche Auto',
    tel: '+39 02 447 8712',
    indirizzo: 'Via Fiume 6',
    citta: 'Corsico',
    cap: '20094',
    telNorm: '024478712',
    waNorm: null,
    emailNorm: null,
    pivaNorm: null,
    createdAt: new Date('2026-03-01T00:00:00Z'),
    ...over,
  });

const identita = () => identitaDaCompany(AGENZIA)[0]!;

describe('valuta', () => {
  it('caso reale Corsico: telefono + indirizzo + città + CAP', () => {
    const v = valuta(identita(), contatto());
    expect(v.ammesso).toBe(true);
    expect(v.campi).toEqual(expect.arrayContaining(['tel', 'indirizzo', 'citta', 'cap']));
    expect(v.punteggio).toBe(80); // 50 tel + 20 indirizzo + 5 citta + 5 cap
  });

  it('la sola prova forte basta se la categoria coincide', () => {
    const v = valuta(
      identita(),
      contatto({ indirizzo: 'Via Altra', citta: 'Milano', cap: '20100', nome: 'Altro Nome' }),
    );
    expect(v.ammesso).toBe(true);
    expect(v.campi).toEqual(['tel']);
  });

  it('nessuna prova forte: mai ammesso, per quanti campi deboli combacino', () => {
    const v = valuta(identita(), contatto({ telNorm: null, tel: null }));
    expect(v.ammesso).toBe(false);
    expect(v.campi).not.toContain('tel');
  });

  it('categoria discorde: la prova forte da sola non basta', () => {
    const soloTel = contatto({
      cat: 'BROKER',
      indirizzo: 'Via Altra',
      citta: 'Milano',
      cap: '20100',
      nome: 'Altro Nome',
    });
    expect(valuta(identita(), soloTel).ammesso).toBe(false);
    // con un secondo indizio passa
    expect(valuta(identita(), contatto({ cat: 'BROKER' })).ammesso).toBe(true);
  });

  it('P.IVA pesa più di tutto', () => {
    const v = valuta(
      identita(),
      contatto({
        pivaNorm: '06199680155',
        telNorm: null,
        tel: null,
        indirizzo: null,
        citta: null,
        cap: null,
        nome: 'Sconosciuta',
      }),
    );
    expect(v.punteggio).toBe(100);
    expect(v.ammesso).toBe(true);
  });

  it('nome identico vale più del nome contenuto', () => {
    const esatto = valuta(
      identita(),
      contatto({ nome: 'Agenzia Corsico di Ciavarella Antonio S.r.l.' }),
    );
    expect(esatto.campi).toContain('nome');
    const parziale = valuta(identita(), contatto({ nome: 'Agenzia Corsico' }));
    expect(parziale.campi).toContain('nome~');
  });

  it('campi vuoti da entrambe le parti non contano come uguali', () => {
    const senzaDeboli = valuta(
      identita(),
      contatto({ indirizzo: null, citta: null, cap: null, nome: '' }),
    );
    expect(senzaDeboli.campi).toEqual(['tel']);
  });

  it('categoria discorde + telefono + solo nome~: NON ammesso (nome~ non vale come secondo indizio)', () => {
    // Categoria discorde: BROKER vs AGENZIA
    // Prova forte: telefono (50 pt)
    // Secondo indizio: solo nome parziale (parole generiche, non conta per ammissione)
    const v = valuta(
      identita(),
      contatto({
        cat: 'BROKER',
        nome: 'Agenzia Corsico', // parziale: contiene due parole del nome vero
        indirizzo: 'Via Diversa', // no match
        citta: 'Milano', // no match
        cap: '20100', // no match
      }),
    );
    expect(v.ammesso).toBe(false); // telefono + nome~ non basta
    expect(v.campi).toContain('tel');
    expect(v.campi).toContain('nome~');
  });

  it('categoria discorde + telefono + nome~ + indirizzo: ammesso (indirizzo è identificante)', () => {
    const v = valuta(
      identita(),
      contatto({
        cat: 'BROKER',
        nome: 'Agenzia Corsico', // parziale, non conta
        indirizzo: 'Via Fiume', // match esatto, conta
        citta: 'Milano', // no match
        cap: '20100', // no match
      }),
    );
    expect(v.ammesso).toBe(true); // telefono + indirizzo basta
    expect(v.campi).toEqual(expect.arrayContaining(['tel', 'indirizzo', 'nome~']));
  });

  it('categoria discorde + telefono + nome~ + cap: NON ammesso (cap non è identificante)', () => {
    // CAP da solo non discrimina nel caso che l'eccezione deve proteggere:
    // due attività diverse nella stessa città condividono il CAP.
    const v = valuta(
      identita(),
      contatto({
        cat: 'BROKER',
        nome: 'Agenzia Corsico', // parziale, non conta
        indirizzo: 'Via Diversa', // no match
        citta: 'Milano', // no match
        cap: '20094', // match esatto, ma non basta da solo
      }),
    );
    expect(v.ammesso).toBe(false); // telefono + cap non basta
    expect(v.campi).toEqual(expect.arrayContaining(['tel', 'cap', 'nome~']));
  });

  it('categoria discorde + telefono + città + CAP uguali: NON ammesso (controesempio reale)', () => {
    // Caso reale pericoloso: due attività diverse (Ristorante Da Mario vs Agenzia)
    // dietro lo stesso centralino di gruppo, nello stesso comune.
    const v = valuta(
      identita(),
      contatto({
        cat: 'BROKER',
        nome: 'Ristorante Da Mario', // totalmente scorrelato
        tel: '+39 02 447 8712', // stesso telefono
        indirizzo: 'Corso Milano 15', // indirizzo diverso
        citta: 'Corsico', // stessa città
        cap: '20094', // stesso CAP
        telNorm: '024478712', // normalizzato
        waNorm: null,
        emailNorm: null,
        pivaNorm: null,
        createdAt: new Date('2026-03-01T00:00:00Z'),
      }),
    );
    expect(v.ammesso).toBe(false); // telefono + città + cap non basta
    expect(v.campi).toContain('tel');
    expect(v.campi).toContain('citta');
    expect(v.campi).toContain('cap');
  });

  it('categoria discorde + telefono + nome esatto: ammesso (nome esatto è identificante)', () => {
    const v = valuta(
      identita(),
      contatto({
        cat: 'BROKER',
        nome: 'Agenzia Corsico di Ciavarella Antonio', // nome esatto, conta
        indirizzo: 'Via Diversa', // no match
        citta: 'Milano', // no match
        cap: '20100', // no match
      }),
    );
    expect(v.ammesso).toBe(true); // telefono + nome esatto basta
    expect(v.campi).toContain('tel');
    expect(v.campi).toContain('nome');
  });
});
