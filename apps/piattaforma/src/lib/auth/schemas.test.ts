import { describe, it, expect } from 'vitest';
import { registerStep2CompanySchema } from './schemas';

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
