import { describe, it, expect } from 'vitest';
import { parseEmails } from './emails';

describe('parseEmails', () => {
  it('separa su virgola, punto-e-virgola, spazio e newline', () => {
    const r = parseEmails('a@x.it, b@x.it; c@x.it\nd@x.it e@x.it');
    expect(r.validi).toEqual(['a@x.it', 'b@x.it', 'c@x.it', 'd@x.it', 'e@x.it']);
    expect(r.scartati).toEqual([]);
  });
  it('normalizza a minuscolo e deduplica', () => {
    const r = parseEmails('Mario@X.it, mario@x.it');
    expect(r.validi).toEqual(['mario@x.it']);
  });
  it('separa i validi dagli invalidi', () => {
    const r = parseEmails('buona@x.it, nonvale, altra@y.it');
    expect(r.validi).toEqual(['buona@x.it', 'altra@y.it']);
    expect(r.scartati).toEqual(['nonvale']);
  });
  it('input vuoto → liste vuote', () => {
    expect(parseEmails('')).toEqual({ validi: [], scartati: [] });
  });
});
