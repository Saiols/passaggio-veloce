import { describe, it, expect } from 'vitest';
import {
  validateVisuraData,
  validateRegistrationDocuments,
  type RegistrationDocInput,
} from './document-validation';

const NOW = new Date('2026-05-30T12:00:00Z');

const validDoc = (tipo: RegistrationDocInput['tipo']): RegistrationDocInput => ({
  tipo,
  mimeType: 'application/pdf',
  sizeBytes: 200 * 1024,
  originalFilename: `${tipo.toLowerCase()}.pdf`,
});

const allDocs = (): RegistrationDocInput[] => [
  validDoc('CI_FRONTE'),
  validDoc('CI_RETRO'),
  validDoc('CODICE_FISCALE'),
  validDoc('VISURA_CAMERALE'),
];

describe('validateVisuraData', () => {
  it('accetta una visura emessa ieri', () => {
    expect(validateVisuraData('2026-05-29', NOW)).toEqual({ ok: true });
  });

  it('accetta una visura emessa esattamente entro 6 mesi', () => {
    expect(validateVisuraData('2025-12-01', NOW)).toEqual({ ok: true });
  });

  it('rifiuta una visura più vecchia di 6 mesi', () => {
    const r = validateVisuraData('2025-10-01', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('6 mesi');
  });

  it('rifiuta una data futura', () => {
    const r = validateVisuraData('2026-06-15', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('futura');
  });

  it('rifiuta una data non valida', () => {
    const r = validateVisuraData('non-una-data', NOW);
    expect(r.ok).toBe(false);
  });
});

describe('validateRegistrationDocuments', () => {
  it('passa con 4 documenti validi e visura recente', () => {
    expect(validateRegistrationDocuments(allDocs(), '2026-05-01', NOW)).toEqual({
      ok: true,
    });
  });

  it('fallisce se manca un documento richiesto', () => {
    const docs = allDocs().filter((d) => d.tipo !== 'CODICE_FISCALE');
    const r = validateRegistrationDocuments(docs, '2026-05-01', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('tutti i documenti');
  });

  it('fallisce se un documento ha MIME non supportato', () => {
    const docs = allDocs();
    docs[0] = { ...docs[0]!, mimeType: 'application/zip' };
    const r = validateRegistrationDocuments(docs, '2026-05-01', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Formato');
  });

  it('fallisce se la visura è scaduta', () => {
    const r = validateRegistrationDocuments(allDocs(), '2025-01-01', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('6 mesi');
  });
});
