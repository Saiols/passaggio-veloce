import { describe, it, expect } from 'vitest';
import { verifyRegistrationKyc, type KycDeps } from './verify';

const allowed = [{ companyType: 'DEALER' as const, code: '4511', active: true }];
const company = { ragioneSociale: 'Rossi Auto SRL', partitaIva: '12345678901', type: 'DEALER' as const };
const fakeInput = { buffer: Buffer.from('x'), mimeType: 'image/png' };
const files = { ciFronte: fakeInput, codiceFiscale: fakeInput, visura: fakeInput };

const goodDeps: KycDeps = {
  getVisuraData: async () => ({
    rawText: '', dataEmissione: '2026-03-15', ateco: '45.11.01',
    denominazione: 'ROSSI AUTO SRL', partitaIva: '12345678901',
    amministratore: { nome: 'MARIO', cognome: 'ROSSI', codiceFiscale: 'RSSMRA80A01H501U' },
  }),
  getCiData: async () => ({ nome: 'MARIO', cognome: 'ROSSI', rawText: '' }),
  getCfData: async () => ({ codiceFiscale: 'RSSMRA80A01H501U', rawText: '' }),
};

describe('verifyRegistrationKyc', () => {
  it('passa quando tutto combacia', async () => {
    const r = await verifyRegistrationKyc({ files, company, allowedAteco: allowed }, goodDeps);
    expect(r.passed).toBe(true);
  });

  it('DEALER con visura vecchissima (oltre 5 mesi): NON blocca più (il ciclo di vita a 180gg la gestisce dopo)', async () => {
    const deps = { ...goodDeps, getVisuraData: async () => ({ ...(await goodDeps.getVisuraData(fakeInput)), dataEmissione: '2024-12-13' }) };
    const r = await verifyRegistrationKyc({ files, company, allowedAteco: allowed }, deps);
    expect(r.passed).toBe(true);
  });

  it('la data della visura resta comunque ESTRATTA anche se vecchia (serve al ciclo di vita)', async () => {
    const deps = { ...goodDeps, getVisuraData: async () => ({ ...(await goodDeps.getVisuraData(fakeInput)), dataEmissione: '2024-12-13' }) };
    const r = await verifyRegistrationKyc({ files, company, allowedAteco: allowed }, deps);
    expect(r.passed && r.extracted.visura.dataEmissione).toBe('2024-12-13');
  });

  it('NON applica alcun controllo di età alla visura, né per DEALER né per AGENZIA', async () => {
    const agenziaCompany = { ...company, type: 'AGENZIA' as const };
    const agenziaAllowed = [{ companyType: 'AGENZIA' as const, code: '4511', active: true }];
    // Visura emessa molto oltre i 5 mesi: né per un'agenzia né per un broker deve bloccare.
    const deps = { ...goodDeps, getVisuraData: async () => ({ ...(await goodDeps.getVisuraData(fakeInput)), dataEmissione: '2024-12-13' }) };
    const r = await verifyRegistrationKyc({ files, company: agenziaCompany, allowedAteco: agenziaAllowed }, deps);
    expect(r.passed).toBe(true);
  });

  it('visura senza dataEmissione leggibile: ILLEGGIBILE (non è un blocco sulla data, è sulla leggibilità)', async () => {
    const deps = { ...goodDeps, getVisuraData: async () => ({ ...(await goodDeps.getVisuraData(fakeInput)), dataEmissione: undefined }) };
    const r = await verifyRegistrationKyc({ files, company, allowedAteco: allowed }, deps);
    expect(r.passed).toBe(false);
    if (!r.passed) expect(r.failures.some((f) => f.rule === 'ILLEGGIBILE')).toBe(true);
  });

  it('blocca ATECO non idoneo', async () => {
    const deps = { ...goodDeps, getVisuraData: async () => ({ ...(await goodDeps.getVisuraData(fakeInput)), ateco: '62.01' }) };
    const r = await verifyRegistrationKyc({ files, company, allowedAteco: allowed }, deps);
    expect(r.passed).toBe(false);
    if (!r.passed) expect(r.failures.some((f) => f.rule === 'ATECO_NON_IDONEO')).toBe(true);
  });

  it('blocca mismatch nome CI', async () => {
    const deps = { ...goodDeps, getCiData: async () => ({ nome: 'LUCA', cognome: 'BIANCHI', rawText: '' }) };
    const r = await verifyRegistrationKyc({ files, company, allowedAteco: allowed }, deps);
    expect(r.passed).toBe(false);
    if (!r.passed) expect(r.failures.some((f) => f.rule === 'CI_MISMATCH')).toBe(true);
  });

  it('blocca mismatch CF', async () => {
    const deps = { ...goodDeps, getCfData: async () => ({ codiceFiscale: 'BNCLCU90A01H501Z', rawText: '' }) };
    const r = await verifyRegistrationKyc({ files, company, allowedAteco: allowed }, deps);
    expect(r.passed).toBe(false);
    if (!r.passed) expect(r.failures.some((f) => f.rule === 'CF_MISMATCH')).toBe(true);
  });

  it('segnala ILLEGGIBILE quando un campo chiave manca', async () => {
    const deps = { ...goodDeps, getCiData: async () => ({ rawText: '' }) };
    const r = await verifyRegistrationKyc({ files, company, allowedAteco: allowed }, deps);
    expect(r.passed).toBe(false);
    if (!r.passed) expect(r.failures.some((f) => f.rule === 'ILLEGGIBILE' && f.doc === 'CI')).toBe(true);
  });

  it('blocca (ILLEGGIBILE) se la visura espone l\'amministratore con solo CF (no nome) anche se il CF combacia', async () => {
    const deps = {
      ...goodDeps,
      getVisuraData: async () => ({ ...(await goodDeps.getVisuraData(fakeInput)), amministratore: { codiceFiscale: 'RSSMRA80A01H501U' } }),
      getCiData: async () => ({ nome: 'LUCA', cognome: 'BIANCHI', rawText: '' }), // CI di un'altra persona
    };
    const r = await verifyRegistrationKyc({ files, company, allowedAteco: allowed }, deps);
    expect(r.passed).toBe(false);
    if (!r.passed) expect(r.failures.some((f) => f.rule === 'ILLEGGIBILE' && f.doc === 'VISURA')).toBe(true);
  });

  it('blocca (ILLEGGIBILE) se la visura non espone il CF dell\'amministratore', async () => {
    const deps = {
      ...goodDeps,
      getVisuraData: async () => ({ ...(await goodDeps.getVisuraData(fakeInput)), amministratore: { nome: 'MARIO', cognome: 'ROSSI' } }),
    };
    const r = await verifyRegistrationKyc({ files, company, allowedAteco: allowed }, deps);
    expect(r.passed).toBe(false);
    if (!r.passed) expect(r.failures.some((f) => f.rule === 'ILLEGGIBILE' && f.doc === 'VISURA')).toBe(true);
  });
});
