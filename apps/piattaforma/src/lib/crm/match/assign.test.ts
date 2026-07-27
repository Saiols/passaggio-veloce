import { describe, it, expect } from 'vitest';
import { assegna, chiaveIdentita } from './assign';
import type { Identita } from './identita';
import { preparaContatto, type ContattoGrezzo } from './score';

const ident = (over: Partial<Identita> = {}): Identita => ({
  companyId: 'c1',
  sedeId: null,
  cat: 'BROKER',
  telKeys: ['024478712'],
  emailKeys: [],
  pivaKeys: [],
  nomeKeys: ['auto rossi'],
  indirizzoKey: 'via fiume',
  cittaKey: 'corsico',
  capKey: '20094',
  registrataAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

const cont = (over: Partial<ContattoGrezzo> = {}) =>
  preparaContatto({
    id: 'x1',
    cat: 'BROKER',
    nome: 'Auto Rossi',
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

describe('assegna', () => {
  it('una identità prende solo il contatto col punteggio più alto', () => {
    // Id scarso='a' (minore alfabeticamente), ricco='z' (maggiore).
    // Se il punteggio non fosse il criterio dominante, il tie-break su id
    // farebbe vincere 'a' (scarso). Ma deve vincere 'z' (ricco) per punteggio.
    const scarso = cont({ id: 'a', nome: 'Altro', indirizzo: null, citta: null, cap: null });
    const ricco = cont({ id: 'z' });
    const out = assegna([ident()], [scarso, ricco]);
    expect(out).toHaveLength(1);
    expect(out[0]!.contatto.id).toBe('z');
  });

  it('a parità di punteggio vince il contatto più vecchio', () => {
    const vecchio = cont({ id: 'vecchio', createdAt: new Date('2026-01-01T00:00:00Z') });
    const nuovo = cont({ id: 'nuovo', createdAt: new Date('2026-06-01T00:00:00Z') });
    const out = assegna([ident()], [nuovo, vecchio]);
    expect(out[0]!.contatto.id).toBe('vecchio');
  });

  it('un contatto conteso da due identità va a una sola', () => {
    const a = ident({ companyId: 'c1' });
    const b = ident({ companyId: 'c2', cittaKey: 'milano', capKey: '20100' });
    const out = assegna([a, b], [cont()]);
    expect(out).toHaveLength(1);
    expect(out[0]!.identita.companyId).toBe('c1'); // più campi in comune
  });

  it('madre e sedi agganciano righe diverse', () => {
    const madre = ident({ sedeId: null });
    const sede = ident({
      sedeId: 's1',
      telKeys: ['0244073411'],
      indirizzoKey: 'viale italia',
      nomeKeys: ['autotorino'],
    });
    const rigaMadre = cont({ id: 'm' });
    const rigaSede = cont({
      id: 's',
      nome: 'Autotorino',
      tel: '+39 02 4407 3411',
      telNorm: '0244073411',
      indirizzo: 'Viale Italia 19',
    });
    const out = assegna([madre, sede], [rigaMadre, rigaSede]);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.identita.sedeId).sort()).toEqual([null, 's1']);
  });

  it('scarta le coppie non ammesse (categoria discorde senza secondo indizio)', () => {
    // Stessa prova forte (telefono), ma categoria diversa (BROKER vs AGENZIA)
    // e nessun secondo indizio identificante (nome, indirizzo, piva, email discordi).
    // Entra nell'indice via telefono, valuta() viene chiamato, ma ammesso=false.
    const brokerIdent = ident({ cat: 'BROKER' });
    const agenziaCont = cont({ cat: 'AGENZIA', nome: 'Altro Negozio', indirizzo: null });
    const out = assegna([brokerIdent], [agenziaCont]);
    expect(out).toEqual([]);
  });

  it('madre e sede "gemelle" (stessi recapiti) contendono lo stesso contatto: vince sempre la sede', () => {
    // Caso reale (Corsico): la sede ha lo stesso nome/telefono/indirizzo
    // della madre → stesso punteggio per lo stesso contatto. Deve vincere
    // sempre la sede (aggancio più preciso), per regola esplicita — non per
    // effetto collaterale dell'ordine alfabetico delle chiavi identità.
    // sedeId='s1' è scelto apposta: 's1' > 'madre' lessicograficamente
    // (s > m), quindi se il codice tornasse a delegare il tie-break alla
    // sola chiaveIdentita (senza la preferenza esplicita), vincerebbe la
    // MADRE — l'opposto di quanto deve succedere. Con un id come nel caso
    // reale ('b4...' < 'madre') l'esito sarebbe "giusto per caso": qui no.
    const madre = ident({ sedeId: null });
    const sede = ident({ sedeId: 's1' });
    const out = assegna([madre, sede], [cont()]);
    expect(out).toHaveLength(1);
    expect(out[0]!.identita.sedeId).toBe('s1');
  });

  it('chiaveIdentita distingue madre e sede', () => {
    expect(chiaveIdentita(ident())).toBe('c1:madre');
    expect(chiaveIdentita(ident({ sedeId: 's1' }))).toBe('c1:s1');
  });

  it('scopre candidati via email come unica prova forte', () => {
    // Email in comune, telefono assente: scoperta via indice email.
    const idWithEmail = ident({ telKeys: [], emailKeys: ['info@autorossi.it'] });
    const contWithEmail = cont({
      id: 'email-match',
      telNorm: null,
      tel: null,
      emailNorm: 'info@autorossi.it',
      // Nome e indirizzo non perfetti, ma email è prova forte
      nome: 'Auto Rossi srl',
      indirizzo: 'Via Fiume 10',
    });
    const out = assegna([idWithEmail], [contWithEmail]);
    expect(out).toHaveLength(1);
    expect(out[0]!.contatto.id).toBe('email-match');
    expect(out[0]!.campi).toContain('email');
  });

  it('nessuna rivale a pari punteggio → proposta non ambigua', () => {
    const out = assegna([ident()], [cont()]);
    expect(out[0]!.ambigua).toBe(false);
  });

  it('due righe della lista contendono la stessa identità a pari punteggio → ambigua', () => {
    // Il caso dei centralini condivisi: due righe con lo STESSO telefono e gli
    // stessi campi deboli fanno lo stesso punteggio sulla stessa azienda. Lo
    // spareggio (contatto più vecchio) è deterministico ma arbitrario nel
    // merito, e l'aggancio non si può disfare.
    const a = cont({ id: 'a', createdAt: new Date('2026-01-01T00:00:00Z') });
    const b = cont({ id: 'b', createdAt: new Date('2026-02-01T00:00:00Z') });
    const out = assegna([ident()], [a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]!.contatto.id).toBe('a');
    expect(out[0]!.ambigua).toBe(true);
  });

  it('due AZIENDE diverse contendono lo stesso contatto a pari punteggio → ambigua', () => {
    // Stesso centralino, stessi campi deboli, due aziende registrate diverse:
    // qui l'aggancio può finire sull'azienda sbagliata. È l'ambiguità che
    // conta davvero, e il canale automatico non deve deciderla da solo.
    const a = ident({ companyId: 'c1' });
    const b = ident({ companyId: 'c2' });
    const out = assegna([a, b], [cont()]);
    expect(out).toHaveLength(1);
    expect(out[0]!.ambigua).toBe(true);
  });

  it('madre e sua sede a pari punteggio NON è ambigua (stessa azienda, regola esplicita)', () => {
    // Misurato sul DB reale: la registrazione crea la "sede principale"
    // copiando nome/indirizzo/telefono/email dalla madre, quindi 20 sedi su
    // 22 sono il gemello della madre e contendono SEMPRE lo stesso contatto
    // con lo stesso punteggio. Se questo pareggio contasse come ambiguo, il
    // caso reale Corsico — il match di riferimento dell'intera feature — non
    // verrebbe mai applicato dal cron. Il pareggio però è già risolto da una
    // regola di progetto (vince la sede) e l'azienda agganciata è la stessa
    // in entrambi i casi.
    const madre = ident({ sedeId: null });
    const sede = ident({ sedeId: 's1' });
    const out = assegna([madre, sede], [cont()]);
    expect(out).toHaveLength(1);
    expect(out[0]!.identita.sedeId).toBe('s1');
    expect(out[0]!.ambigua).toBe(false);
  });

  it('rivale con punteggio DIVERSO non rende ambigua la vincente', () => {
    // La vincente ha più campi in comune: la scelta è nel merito, non un
    // ex aequo. Un'implementazione che marcasse ambigua ogni coppia con una
    // concorrente qualsiasi bloccherebbe il cron su quasi tutto.
    const ricco = cont({ id: 'ricco' });
    const scarso = cont({ id: 'scarso', nome: 'Altro', indirizzo: null, citta: null, cap: null });
    const out = assegna([ident()], [ricco, scarso]);
    expect(out).toHaveLength(1);
    expect(out[0]!.contatto.id).toBe('ricco');
    expect(out[0]!.ambigua).toBe(false);
  });

  it('scopre candidati via P.IVA come unica prova forte', () => {
    // P.IVA in comune, telefono e email assenti: scoperta via indice P.IVA.
    const idWithPiva = ident({
      telKeys: [],
      emailKeys: [],
      pivaKeys: ['12345678901'],
    });
    const contWithPiva = cont({
      id: 'piva-match',
      telNorm: null,
      tel: null,
      emailNorm: null,
      pivaNorm: '12345678901',
      nome: 'Auto Rossi',
      indirizzo: 'Via Fiume 6',
    });
    const out = assegna([idWithPiva], [contWithPiva]);
    expect(out).toHaveLength(1);
    expect(out[0]!.contatto.id).toBe('piva-match');
    expect(out[0]!.campi).toContain('piva');
  });
});
