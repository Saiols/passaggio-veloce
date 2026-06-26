import { describe, it, expect } from 'vitest';
import {
  resolveAccessibleSedi,
  resolveCurrentSede,
  assertSedeAccess,
  canSelectSede,
  sedeScopeIds,
  resolveOperatingSede,
  resolveSubmittedSede,
  type SedeRef,
} from './scope';

const sedeA: SedeRef = { id: 'a', nome: 'Sede A', type: 'AGENZIA' };
const sedeB: SedeRef = { id: 'b', nome: 'Sede B', type: 'AGENZIA' };
const sedeC: SedeRef = { id: 'c', nome: 'Sede C', type: 'AGENZIA' };
const companySedi = [sedeA, sedeB, sedeC];

describe('resolveAccessibleSedi', () => {
  it('owner: accede a tutte le sedi della madre', () => {
    const r = resolveAccessibleSedi({ isOwner: true, companySedi, membershipSedeIds: [] });
    expect(r).toEqual(companySedi);
  });

  it('non-owner: accede solo alle sedi in membership', () => {
    const r = resolveAccessibleSedi({
      isOwner: false,
      companySedi,
      membershipSedeIds: ['a', 'c'],
    });
    expect(r).toEqual([sedeA, sedeC]);
  });

  it('non-owner senza membership: nessuna sede', () => {
    const r = resolveAccessibleSedi({ isOwner: false, companySedi, membershipSedeIds: [] });
    expect(r).toEqual([]);
  });
});

describe('resolveCurrentSede', () => {
  it("owner senza cookie: vista aggregata ALL", () => {
    const r = resolveCurrentSede({ isOwner: true, accessibleSedi: companySedi, cookieValue: null });
    expect(r).toEqual({ kind: 'ALL' });
  });

  it("owner con cookie 'ALL': vista aggregata ALL", () => {
    const r = resolveCurrentSede({ isOwner: true, accessibleSedi: companySedi, cookieValue: 'ALL' });
    expect(r).toEqual({ kind: 'ALL' });
  });

  it('owner con cookie sede valida: quella sede', () => {
    const r = resolveCurrentSede({ isOwner: true, accessibleSedi: companySedi, cookieValue: 'b' });
    expect(r).toEqual({ kind: 'ONE', sede: sedeB });
  });

  it('owner con cookie sede stale/non valida: fallback ALL', () => {
    const r = resolveCurrentSede({ isOwner: true, accessibleSedi: companySedi, cookieValue: 'zzz' });
    expect(r).toEqual({ kind: 'ALL' });
  });

  it('non-owner con 1 sola sede senza cookie: quella sede', () => {
    const r = resolveCurrentSede({ isOwner: false, accessibleSedi: [sedeA], cookieValue: null });
    expect(r).toEqual({ kind: 'ONE', sede: sedeA });
  });

  it('non-owner multi senza cookie: la prima (deterministico)', () => {
    const r = resolveCurrentSede({
      isOwner: false,
      accessibleSedi: [sedeA, sedeB],
      cookieValue: null,
    });
    expect(r).toEqual({ kind: 'ONE', sede: sedeA });
  });

  it('non-owner con cookie sede valida: quella sede', () => {
    const r = resolveCurrentSede({
      isOwner: false,
      accessibleSedi: [sedeA, sedeB],
      cookieValue: 'b',
    });
    expect(r).toEqual({ kind: 'ONE', sede: sedeB });
  });

  it("non-owner con cookie 'ALL' (non permesso): fallback alla prima sede", () => {
    const r = resolveCurrentSede({
      isOwner: false,
      accessibleSedi: [sedeA, sedeB],
      cookieValue: 'ALL',
    });
    expect(r).toEqual({ kind: 'ONE', sede: sedeA });
  });

  it('non-owner senza sedi accessibili: null', () => {
    const r = resolveCurrentSede({ isOwner: false, accessibleSedi: [], cookieValue: null });
    expect(r).toBeNull();
  });
});

describe('assertSedeAccess', () => {
  it('true se la sede è tra quelle accessibili', () => {
    expect(assertSedeAccess('b', companySedi)).toBe(true);
  });

  it('false se la sede non è accessibile', () => {
    expect(assertSedeAccess('zzz', companySedi)).toBe(false);
  });
});

describe('sedeScopeIds', () => {
  it('null → lista vuota', () => {
    expect(sedeScopeIds({ currentSede: null, accessibleSedi: companySedi })).toEqual([]);
  });

  it('ONE → solo quella sede', () => {
    expect(
      sedeScopeIds({ currentSede: { kind: 'ONE', sede: sedeB }, accessibleSedi: companySedi }),
    ).toEqual(['b']);
  });

  it('ALL → tutte le sedi accessibili (vista aggregata proprietario)', () => {
    expect(
      sedeScopeIds({ currentSede: { kind: 'ALL' }, accessibleSedi: companySedi }),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('resolveOperatingSede', () => {
  it('ONE → quella sede', () => {
    expect(
      resolveOperatingSede({ currentSede: { kind: 'ONE', sede: sedeB }, accessibleSedi: companySedi }),
    ).toEqual(sedeB);
  });

  it('ALL con una sola sede (caso 1:1) → quella sede', () => {
    expect(
      resolveOperatingSede({ currentSede: { kind: 'ALL' }, accessibleSedi: [sedeA] }),
    ).toEqual(sedeA);
  });

  it('ALL con più sedi → null (serve selezione)', () => {
    expect(
      resolveOperatingSede({ currentSede: { kind: 'ALL' }, accessibleSedi: companySedi }),
    ).toBeNull();
  });

  it('nessuna sede → null', () => {
    expect(resolveOperatingSede({ currentSede: null, accessibleSedi: [] })).toBeNull();
  });
});

describe('resolveSubmittedSede', () => {
  // Sede broker per una scrittura (creazione pratica) quando il client può
  // inviare esplicitamente l'id sede scelto nel wizard.
  it('id inviato e accessibile → quella sede', () => {
    expect(
      resolveSubmittedSede({
        submittedId: 'b',
        currentSede: { kind: 'ALL' },
        accessibleSedi: companySedi,
      }),
    ).toEqual(sedeB);
  });

  it('id inviato NON accessibile → null (nessun fallback silenzioso)', () => {
    expect(
      resolveSubmittedSede({
        submittedId: 'zzz',
        currentSede: { kind: 'ONE', sede: sedeA },
        accessibleSedi: companySedi,
      }),
    ).toBeNull();
  });

  it('nessun id inviato, vista ONE → la sede operativa', () => {
    expect(
      resolveSubmittedSede({
        submittedId: null,
        currentSede: { kind: 'ONE', sede: sedeB },
        accessibleSedi: companySedi,
      }),
    ).toEqual(sedeB);
  });

  it('nessun id inviato, ALL con una sola sede → quella sede', () => {
    expect(
      resolveSubmittedSede({
        submittedId: undefined,
        currentSede: { kind: 'ALL' },
        accessibleSedi: [sedeA],
      }),
    ).toEqual(sedeA);
  });

  it('nessun id inviato, ALL con più sedi → null (serve selezione)', () => {
    expect(
      resolveSubmittedSede({
        submittedId: '',
        currentSede: { kind: 'ALL' },
        accessibleSedi: companySedi,
      }),
    ).toBeNull();
  });
});

describe('canSelectSede', () => {
  it("'ALL' permesso solo al proprietario", () => {
    expect(canSelectSede('ALL', { isOwner: true, accessibleSedi: companySedi })).toBe(true);
    expect(canSelectSede('ALL', { isOwner: false, accessibleSedi: companySedi })).toBe(false);
  });

  it('sede accessibile: permesso', () => {
    expect(canSelectSede('b', { isOwner: false, accessibleSedi: [sedeB] })).toBe(true);
  });

  it('sede non accessibile: negato', () => {
    expect(canSelectSede('a', { isOwner: false, accessibleSedi: [sedeB] })).toBe(false);
  });
});
