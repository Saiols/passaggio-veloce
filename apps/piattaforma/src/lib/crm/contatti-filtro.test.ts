import { describe, it, expect } from 'vitest';
import { whereContatti } from './contatti-filtro';

const adesso = '2026-08-01T10:00:00.000Z';

describe('whereContatti', () => {
  it('sempre esclude i soft-deleted', () => {
    expect(whereContatti({ adesso }).deletedAt).toBeNull();
  });
  it('preset richiamo: nextContactAt<=soglia e non ancora registrato', () => {
    const w = whereContatti({ preset: 'richiamo', adesso });
    expect(w.iscrizioneComp).toBe(false);
    expect(w.nextContactAt).toHaveProperty('lte');
  });
  it('preset urgenti: include interessati via giudizio', () => {
    const w = whereContatti({ preset: 'urgenti', adesso });
    expect(JSON.stringify(w)).toContain('INTERESSATO');
  });
  it('scoping SALES filtra per assegnatario', () => {
    expect(whereContatti({ adesso, soloAssegnatoAId: 'sales-1' }).assignedToId).toBe('sales-1');
  });
  it('testo libero cerca su nome/email/tel', () => {
    const w = whereContatti({ adesso, q: 'rossi' });
    expect(w.OR).toBeTruthy();
  });
});
