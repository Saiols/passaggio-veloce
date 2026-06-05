import { describe, it, expect, vi } from 'vitest';

vi.mock('@/env', () => ({ env: { AUTH_SECRET: 'test-secret-test-secret-test-secret-32' } }));

import { signKycToken, verifyKycToken, hashDocs } from './token';

const extracted = {
  visura: {
    rawText: 'TESTO GREZZO LUNGO',
    dataEmissione: '2026-03-02',
    ateco: '47.81.10',
    atecoCodes: ['47.81.10', '45.11.01'],
    denominazione: 'DIMENSIONE AUTO MILANO SRLS',
    partitaIva: '13180640966',
    amministratore: { nome: 'ANDREA', cognome: 'SAINO', codiceFiscale: 'SNANDR96D23F205Z' },
  },
  ci: { nome: 'ANDREA', cognome: 'SAINO', rawText: 'CI RAW' },
  cf: { codiceFiscale: 'SNANDR96D23F205Z', rawText: 'CF RAW' },
};

const now = 1_750_000_000_000;
const hash = hashDocs([Buffer.from('a'), Buffer.from('b'), Buffer.from('c')]);

describe('kyc token', () => {
  it('firma e verifica un token valido (stesso hash, non scaduto)', () => {
    const t = signKycToken(hash, extracted, now);
    const r = verifyKycToken(t, hash, now + 1000);
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.extracted.visura.partitaIva).toBe('13180640966');
      expect(r.extracted.cf.codiceFiscale).toBe('SNANDR96D23F205Z');
      // rawText rimosso dal token (no PII pesante)
      expect(r.extracted.visura.rawText).toBe('');
      expect(r.extracted.ci.rawText).toBe('');
    }
  });

  it('rifiuta se i file (hash) non combaciano', () => {
    const t = signKycToken(hash, extracted, now);
    expect(verifyKycToken(t, 'altro-hash', now + 1000).valid).toBe(false);
  });

  it('rifiuta token scaduto (oltre 30 min)', () => {
    const t = signKycToken(hash, extracted, now);
    expect(verifyKycToken(t, hash, now + 31 * 60 * 1000).valid).toBe(false);
  });

  it('rifiuta firma manomessa', () => {
    const t = signKycToken(hash, extracted, now);
    const tampered = t.slice(0, -3) + (t.endsWith('AAA') ? 'BBB' : 'AAA');
    expect(verifyKycToken(tampered, hash, now + 1000).valid).toBe(false);
  });

  it('rifiuta payload manomesso (hash diverso da quello firmato)', () => {
    const t = signKycToken(hash, extracted, now);
    const [, sig] = t.split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({ h: 'altro-hash', e: extracted, x: now + 1000 }),
      'utf8',
    ).toString('base64url');
    expect(verifyKycToken(`${forgedBody}.${sig}`, 'altro-hash', now + 1000).valid).toBe(false);
  });

  it('hashDocs è deterministico e cambia se cambiano i file', () => {
    expect(hashDocs([Buffer.from('x')])).toBe(hashDocs([Buffer.from('x')]));
    expect(hashDocs([Buffer.from('x')])).not.toBe(hashDocs([Buffer.from('y')]));
  });
});
