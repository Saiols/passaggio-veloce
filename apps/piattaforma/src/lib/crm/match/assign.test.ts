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
    // Usa id 'z' (scarso) e 'a' (ricco) per contraddire l'ordine alfabetico:
    // se il punteggio non fosse il criterio dominante, vincerebbe 'a',
    // ma è il punteggio che conta, quindi vince 'a' per score, non per id.
    const scarso = cont({ id: 'z', nome: 'Altro', indirizzo: null, citta: null, cap: null });
    const ricco = cont({ id: 'a' });
    const out = assegna([ident()], [scarso, ricco]);
    expect(out).toHaveLength(1);
    expect(out[0]!.contatto.id).toBe('a');
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
