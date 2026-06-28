import { describe, it, expect } from 'vitest';
import { classifyDocumento } from './classifier';

describe('classifyDocumento', () => {
  const baseValid = {
    mimeType: 'application/pdf',
    sizeBytes: 200 * 1024,
    originalFilename: 'doc.pdf',
  };

  it('passes a valid PDF', () => {
    expect(classifyDocumento({ ...baseValid, tipo: 'CODICE_FISCALE' })).toEqual({
      stato: 'PASSED',
    });
  });

  it('passes a JPG image', () => {
    expect(
      classifyDocumento({
        tipo: 'CI_FRONTE',
        mimeType: 'image/jpeg',
        sizeBytes: 1024 * 200,
        originalFilename: 'fronte.jpg',
      }),
    ).toEqual({ stato: 'PASSED' });
  });

  it('fails on unsupported MIME', () => {
    const r = classifyDocumento({
      ...baseValid,
      tipo: 'CODICE_FISCALE',
      mimeType: 'application/zip',
    });
    expect(r.stato).toBe('FAILED');
    if (r.stato === 'FAILED') expect(r.reason).toContain('Formato');
  });

  it('fails on file too small', () => {
    const r = classifyDocumento({
      ...baseValid,
      tipo: 'CI_FRONTE',
      sizeBytes: 100,
    });
    expect(r.stato).toBe('FAILED');
    if (r.stato === 'FAILED') expect(r.reason).toContain('troppo piccolo');
  });

  it('fails on file too large', () => {
    const r = classifyDocumento({
      ...baseValid,
      tipo: 'CI_FRONTE',
      sizeBytes: 20 * 1024 * 1024,
    });
    expect(r.stato).toBe('FAILED');
    if (r.stato === 'FAILED') expect(r.reason).toContain('troppo grande');
  });

  it('fails CI_FRONTE if filename suggests retro', () => {
    const r = classifyDocumento({
      ...baseValid,
      tipo: 'CI_FRONTE',
      originalFilename: 'CI-retro-mario.jpg',
      mimeType: 'image/jpeg',
    });
    expect(r.stato).toBe('FAILED');
    if (r.stato === 'FAILED') expect(r.reason).toContain('retro');
  });

  it('fails CI_RETRO if filename suggests front', () => {
    const r = classifyDocumento({
      ...baseValid,
      tipo: 'CI_RETRO',
      originalFilename: 'fronte_carta_id.pdf',
    });
    expect(r.stato).toBe('FAILED');
    if (r.stato === 'FAILED') expect(r.reason).toContain('fronte');
  });

  it('does not check filename hints for non-CI documents', () => {
    expect(
      classifyDocumento({
        ...baseValid,
        tipo: 'VISURA_CAMERALE',
        originalFilename: 'documento_fronte_retro.pdf',
      }),
    ).toEqual({ stato: 'PASSED' });
  });

  it('fails VISURA_CAMERALE if not a PDF (immagine rifiutata)', () => {
    const r = classifyDocumento({
      tipo: 'VISURA_CAMERALE',
      mimeType: 'image/jpeg',
      sizeBytes: 200 * 1024,
      originalFilename: 'visura.jpg',
    });
    expect(r.stato).toBe('FAILED');
    if (r.stato === 'FAILED') expect(r.reason).toContain('PDF');
  });

  it('passes VISURA_CAMERALE in PDF', () => {
    expect(
      classifyDocumento({ ...baseValid, tipo: 'VISURA_CAMERALE', originalFilename: 'visura.pdf' }),
    ).toEqual({ stato: 'PASSED' });
  });
});
