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
    const scarso = cont({ id: 'x2', nome: 'Altro', indirizzo: null, citta: null, cap: null });
    const ricco = cont({ id: 'x1' });
    const out = assegna([ident()], [scarso, ricco]);
    expect(out).toHaveLength(1);
    expect(out[0]!.contatto.id).toBe('x1');
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

  it('scarta le coppie non ammesse', () => {
    const out = assegna([ident()], [cont({ telNorm: null, tel: null })]);
    expect(out).toEqual([]);
  });

  it('chiaveIdentita distingue madre e sede', () => {
    expect(chiaveIdentita(ident())).toBe('c1:madre');
    expect(chiaveIdentita(ident({ sedeId: 's1' }))).toBe('c1:s1');
  });
});
