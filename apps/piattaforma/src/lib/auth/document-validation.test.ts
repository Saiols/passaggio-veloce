import { describe, it, expect } from 'vitest';
import {
  validateVisuraData,
  validateRegistrationDocuments,
  isVisuraDateValid,
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

  it('accetta una visura emessa esattamente 6 mesi fa (boundary)', () => {
    expect(validateVisuraData('2025-11-30', NOW)).toEqual({ ok: true });
  });

  it('non rifiuta per overflow di fine mese (31 ago - 6 mesi = 28 feb)', () => {
    const lateAug = new Date('2026-08-31T12:00:00Z');
    expect(validateVisuraData('2026-03-01', lateAug)).toEqual({ ok: true });
  });
});

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
  it('passa con i 4 documenti validi', () => {
    expect(validateRegistrationDocuments(allDocs())).toEqual({ ok: true });
  });

  it('fallisce se manca un documento richiesto', () => {
    const docs = allDocs().filter((d) => d.tipo !== 'CODICE_FISCALE');
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
