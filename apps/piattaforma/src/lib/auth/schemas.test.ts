import { describe, it, expect } from 'vitest';
import { registerStep2CompanySchema, registerStep4PaymentSchema } from './schemas';

const baseCompany = {
  type: 'DEALER' as const,
  ragioneSociale: 'Rossi Auto',
  partitaIva: '12345678901',
  codiceSdi: 'ABC1234',
  pec: 'rossi@pec.it',
  email: 'info@rossi.it',
  telefono: '0612345678',
  indirizzo: 'Via Roma',
  civico: '1',
  citta: 'Roma',
  cap: '00100',
  provincia: 'RM',
};

describe('registerStep2CompanySchema — regime fiscale', () => {
  it('DEALER senza regimeFiscale → non valido', () => {
    const r = registerStep2CompanySchema.safeParse(baseCompany);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes('regimeFiscale'))).toBe(true);
    }
  });

  it('DEALER con regimeFiscale FORFETTARIO → valido', () => {
    const r = registerStep2CompanySchema.safeParse({ ...baseCompany, regimeFiscale: 'FORFETTARIO' });
    expect(r.success).toBe(true);
  });

  it('DEALER con regimeFiscale ORDINARIO → valido', () => {
    const r = registerStep2CompanySchema.safeParse({ ...baseCompany, regimeFiscale: 'ORDINARIO' });
    expect(r.success).toBe(true);
  });

  it('AGENZIA senza regimeFiscale → valido (non richiesto)', () => {
    const r = registerStep2CompanySchema.safeParse({ ...baseCompany, type: 'AGENZIA' });
    expect(r.success).toBe(true);
  });

  it('regimeFiscale con valore non ammesso → non valido', () => {
    const r = registerStep2CompanySchema.safeParse({ ...baseCompany, regimeFiscale: 'BOH' });
    expect(r.success).toBe(false);
  });
});

describe('registerStep4PaymentSchema — accettazioni', () => {
  const basePayment = {
    iban: 'IT60X0542811101000000123456',
    sepaMandateAccepted: true as const,
    termsAccepted: true as const,
    clausoleVessatorieAccepted: true as const,
  };

  it('con entrambe le accettazioni → valido', () => {
    expect(registerStep4PaymentSchema.safeParse(basePayment).success).toBe(true);
  });

  it('senza approvazione specifica clausole vessatorie → non valido', () => {
    expect(
      registerStep4PaymentSchema.safeParse({
        iban: basePayment.iban,
        sepaMandateAccepted: true,
        termsAccepted: true,
      }).success,
    ).toBe(false);
  });

  it('clausole vessatorie = false → non valido', () => {
    const r = registerStep4PaymentSchema.safeParse({ ...basePayment, clausoleVessatorieAccepted: false });
    expect(r.success).toBe(false);
  });

  it('senza accettazione termini → non valido', () => {
    expect(
      registerStep4PaymentSchema.safeParse({
        iban: basePayment.iban,
        sepaMandateAccepted: true,
        clausoleVessatorieAccepted: true,
      }).success,
    ).toBe(false);
  });
});
