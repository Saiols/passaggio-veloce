import { describe, it, expect } from 'vitest';
import {
  validateRegistrationDocuments,
  isVisuraDateValid,
  type RegistrationDocInput,
} from './document-validation';

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
  validDoc('CODICE_FISCALE_RETRO'),
  validDoc('VISURA_CAMERALE'),
];

describe('isVisuraDateValid (parametrico)', () => {
  const now = new Date('2026-06-04T12:00:00Z');
  it('valida entro 5 mesi', () => {
    expect(isVisuraDateValid('2026-02-01', 5, now)).toEqual({ ok: true });
  });
  it('blocca oltre 5 mesi', () => {
    const r = isVisuraDateValid('2025-12-01', 5, now);
    expect(r.ok).toBe(false);
  });
  it('blocca data futura', () => {
    expect(isVisuraDateValid('2026-07-01', 5, now).ok).toBe(false);
  });
});

describe('validateRegistrationDocuments', () => {
  it('passa con i 5 documenti validi', () => {
    expect(validateRegistrationDocuments(allDocs())).toEqual({ ok: true });
  });

  it('fallisce se manca un documento richiesto', () => {
    const docs = allDocs().filter((d) => d.tipo !== 'CODICE_FISCALE');
    const r = validateRegistrationDocuments(docs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('tutti i documenti');
  });

  it('fallisce se manca il retro del codice fiscale', () => {
    const docs = allDocs().filter((d) => d.tipo !== 'CODICE_FISCALE_RETRO');
    const r = validateRegistrationDocuments(docs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('tutti i documenti');
  });

  it('fallisce se un documento ha MIME non supportato', () => {
    const docs = allDocs();
    docs[0] = { ...docs[0]!, mimeType: 'application/zip' };
    const r = validateRegistrationDocuments(docs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Formato');
  });
});
