import { describe, it, expect } from 'vitest';
import {
  COOKIE_CONSENT_STORAGE_KEY,
  hasAnalyticsConsent,
  parseConsent,
  serializeConsent,
} from './consent';

describe('parseConsent', () => {
  it('legge un record valido', () => {
    const raw = JSON.stringify({
      essenziali: true,
      analytics: true,
      marketing: false,
      ts: '2026-07-26T10:00:00.000Z',
    });
    expect(parseConsent(raw)).toEqual({
      essenziali: true,
      analytics: true,
      marketing: false,
      ts: '2026-07-26T10:00:00.000Z',
    });
  });

  it.each([
    ['storage vuoto', null],
    ['stringa vuota', ''],
    ['JSON illeggibile', '{non-json'],
    ['JSON valido ma non un oggetto', '"acconsento"'],
    ['null', 'null'],
    ['flag mancanti', '{"essenziali":true}'],
    ['flag di tipo sbagliato', '{"analytics":"si","marketing":"no"}'],
  ])('%s → nessun consenso', (_caso, raw) => {
    expect(parseConsent(raw)).toBeNull();
  });

  it('essenziali resta true anche se il record salvato dicesse il contrario', () => {
    // Sessione e CSRF non sono rinunciabili: nessun valore in storage — nemmeno
    // manomesso a mano dalla console — può spegnerli.
    const raw = '{"essenziali":false,"analytics":false,"marketing":false,"ts":"x"}';
    expect(parseConsent(raw)?.essenziali).toBe(true);
  });
});

describe('hasAnalyticsConsent — fail-closed', () => {
  it('true solo con analytics esplicitamente true', () => {
    expect(hasAnalyticsConsent('{"analytics":true,"marketing":false,"ts":"x"}')).toBe(true);
  });

  it.each([
    ['analytics false', '{"analytics":false,"marketing":true,"ts":"x"}'],
    ['record assente', null],
    ['record corrotto', 'xxx'],
    ['solo marketing accettato', '{"analytics":false,"marketing":true,"ts":"x"}'],
  ])('%s → niente tracciamento', (_caso, raw) => {
    expect(hasAnalyticsConsent(raw)).toBe(false);
  });
});

describe('chiave di storage', () => {
  it('è la v2: il consenso raccolto prima di Google Analytics non vale', () => {
    // v1 fu raccolta quando il banner diceva «Nessun cookie di terze parti
    // attualmente attivo». Se qualcuno riportasse la chiave a v1, i consensi
    // prestati a quelle condizioni tornerebbero validi per un trattamento che
    // non era stato descritto: qui si rompe il test, non la conformità.
    expect(COOKIE_CONSENT_STORAGE_KEY).toBe('pv-cookie-consent-v2');
  });
});

describe('serializeConsent', () => {
  it('produce un record che parseConsent rilegge identico (round-trip)', () => {
    const raw = serializeConsent({ analytics: true, marketing: false }, '2026-07-26T09:00:00.000Z');
    expect(parseConsent(raw)).toEqual({
      essenziali: true,
      analytics: true,
      marketing: false,
      ts: '2026-07-26T09:00:00.000Z',
    });
  });
});
