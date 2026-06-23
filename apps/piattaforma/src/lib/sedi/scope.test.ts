import { describe, it, expect } from 'vitest';
import {
  resolveAccessibleSedi,
  resolveCurrentSede,
  assertSedeAccess,
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
