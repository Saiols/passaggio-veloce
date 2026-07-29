import { describe, it, expect } from 'vitest';
import { buildContactsQuery } from './query';

describe('buildContactsQuery', () => {
  it('vuoto → stringa vuota', () => {
    expect(buildContactsQuery({})).toBe('');
  });

  it('omette sort di default (recente) e page 1', () => {
    expect(buildContactsQuery({ sort: 'recente', page: 1 })).toBe('');
  });

  it('include sort non-default e page > 1', () => {
    const qs = buildContactsQuery({ sort: 'nome', page: 3 });
    expect(qs).toContain('sort=nome');
    expect(qs).toContain('page=3');
  });

  it('include i filtri valorizzati e il preset', () => {
    const qs = buildContactsQuery({
      q: 'rossi', cat: 'BROKER', status: 'S3', regione: 'Lombardia',
      assigned: 'u1', preset: 'urgenti',
    });
    expect(qs).toContain('q=rossi');
    expect(qs).toContain('cat=BROKER');
    expect(qs).toContain('status=S3');
    expect(qs).toContain('regione=Lombardia');
    expect(qs).toContain('assigned=u1');
    expect(qs).toContain('preset=urgenti');
  });

  it('omette valori vuoti', () => {
    expect(buildContactsQuery({ q: '', cat: '', status: '' })).toBe('');
  });

  it('il preset dei richiami finisce in querystring come gli altri', () => {
    expect(buildContactsQuery({ preset: 'richiamo' })).toBe('preset=richiamo');
  });
});
