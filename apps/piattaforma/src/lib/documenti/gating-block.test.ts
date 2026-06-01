import { describe, it, expect } from 'vitest';
import { findBlockingDocuments } from './gating-block';

describe('findBlockingDocuments', () => {
  const ok = {
    owner: 'venditore' as const,
    tipo: 'CODICE_FISCALE',
    mimeType: 'application/pdf',
    sizeBytes: 200 * 1024,
    originalFilename: 'cf.pdf',
  };

  it('returns empty when all documents pass', () => {
    expect(findBlockingDocuments([ok])).toEqual([]);
  });

  it('flags a document with unsupported MIME', () => {
    const blocking = findBlockingDocuments([{ ...ok, mimeType: 'application/zip' }]);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].owner).toBe('venditore');
    expect(blocking[0].tipo).toBe('CODICE_FISCALE');
    expect(blocking[0].reason).toContain('Formato');
  });

  it('flags a file too small and keeps the passing ones out', () => {
    const blocking = findBlockingDocuments([ok, { ...ok, tipo: 'CI_FRONTE', sizeBytes: 100 }]);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].tipo).toBe('CI_FRONTE');
  });

  it('returns empty for an empty input list', () => {
    expect(findBlockingDocuments([])).toEqual([]);
  });

  it('flags a CI_FRONTE whose filename suggests retro', () => {
    const blocking = findBlockingDocuments([
      { owner: 'venditore', tipo: 'CI_FRONTE', mimeType: 'image/jpeg', sizeBytes: 200 * 1024, originalFilename: 'documento-retro.jpg' },
    ]);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].reason).toContain('retro');
  });

  it('preserves the acquirente owner on blocking docs', () => {
    const blocking = findBlockingDocuments([
      { owner: 'acquirente', tipo: 'CODICE_FISCALE', mimeType: 'application/zip', sizeBytes: 200 * 1024, originalFilename: 'cf.zip' },
    ]);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].owner).toBe('acquirente');
  });
});
