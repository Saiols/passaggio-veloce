import { describe, it, expect } from 'vitest';
import { gaCookieNames, gaDisableFlag, isValidMeasurementId, shouldLoadGa } from './ga';

const CONSENSO_SI = '{"analytics":true,"marketing":true,"ts":"x"}';
const CONSENSO_NO = '{"analytics":false,"marketing":false,"ts":"x"}';

describe('isValidMeasurementId', () => {
  it.each(['G-ABCD1234', 'G-XYZ789012A'])('accetta %s', (id) => {
    expect(isValidMeasurementId(id)).toBe(true);
  });

  it.each([
    ['vuoto', ''],
    ['placeholder lasciato nel .env', 'G-XXXXXXX'.slice(0, 2)],
    ['UA legacy', 'UA-12345-1'],
    ['minuscolo', 'g-abcd1234'],
    ['solo prefisso', 'G-'],
    ['con spazi', ' G-ABCD1234 '],
  ])('rifiuta %s', (_caso, id) => {
    expect(isValidMeasurementId(id)).toBe(false);
  });
});

/**
 * Il punto in cui si decide se un utente viene tracciato. Le due condizioni
 * sono in AND e nessuna delle due è aggirabile: senza ID non esiste proprietà
 * su cui inviare, senza consenso non abbiamo il diritto di inviare.
 */
describe('shouldLoadGa', () => {
  it('ID valido + consenso analytics → carica', () => {
    expect(shouldLoadGa({ measurementId: 'G-ABCD1234', consentRaw: CONSENSO_SI })).toBe(true);
  });

  it('ID valido ma consenso negato → non carica', () => {
    expect(shouldLoadGa({ measurementId: 'G-ABCD1234', consentRaw: CONSENSO_NO })).toBe(false);
  });

  it('ID valido ma nessuna scelta ancora fatta → non carica (fail-closed)', () => {
    expect(shouldLoadGa({ measurementId: 'G-ABCD1234', consentRaw: null })).toBe(false);
  });

  it('consenso pieno ma variabile non impostata → non carica', () => {
    // È lo stato in cui vive la piattaforma finché la proprietà GA4 non esiste:
    // il codice è in prod, inerte, e non scrive un solo cookie.
    expect(shouldLoadGa({ measurementId: '', consentRaw: CONSENSO_SI })).toBe(false);
  });

  it('consenso pieno ma ID malformato → non carica', () => {
    expect(shouldLoadGa({ measurementId: 'UA-12345-1', consentRaw: CONSENSO_SI })).toBe(false);
  });
});

describe('gaDisableFlag', () => {
  it("è il nome del flag globale che gtag.js interroga per auto-spegnersi", () => {
    expect(gaDisableFlag('G-ABCD1234')).toBe('ga-disable-G-ABCD1234');
  });
});

describe('gaCookieNames', () => {
  it('trova _ga e il cookie di container _ga_<ID>, lasciando stare gli altri', () => {
    const cookie =
      'authjs.session-token=abc; _ga=GA1.1.123.456; _ga_ABCD1234=GS1.1.789; pv-cookie-consent-v2={}';
    expect(gaCookieNames(cookie)).toEqual(['_ga', '_ga_ABCD1234']);
  });

  it('non tocca i cookie tecnici della piattaforma', () => {
    const cookie = 'authjs.session-token=abc; authjs.csrf-token=def';
    expect(gaCookieNames(cookie)).toEqual([]);
  });

  it('stringa vuota → nessun nome', () => {
    expect(gaCookieNames('')).toEqual([]);
  });

  it('non confonde un cookie che INIZIA per _ga senza esserlo', () => {
    // `_gaudi` non è un cookie GA: il match è esatto oppure sul separatore `_`.
    expect(gaCookieNames('_gaudi=1; _ga=2')).toEqual(['_ga']);
  });
});
