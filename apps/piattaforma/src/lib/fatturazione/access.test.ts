import { describe, it, expect } from 'vitest';
import { canViewDocumentoFiscale } from './access';

const doc = (emittenteCompanyId: string | null, destinatarioCompanyId: string | null) => ({
  emittenteCompanyId,
  destinatarioCompanyId,
});

describe('canViewDocumentoFiscale', () => {
  it('admin piattaforma vede qualsiasi documento', () => {
    expect(
      canViewDocumentoFiscale(doc(null, 'agenzia1'), { companyId: 'altro', isAdminPiattaforma: true }),
    ).toBe(true);
  });

  it('emittente == company del viewer → visibile', () => {
    expect(
      canViewDocumentoFiscale(doc('broker1', null), { companyId: 'broker1', isAdminPiattaforma: false }),
    ).toBe(true);
  });

  it('destinatario == company del viewer → visibile', () => {
    expect(
      canViewDocumentoFiscale(doc(null, 'agenzia1'), { companyId: 'agenzia1', isAdminPiattaforma: false }),
    ).toBe(true);
  });

  it('né emittente né destinatario → non visibile (es. broker sulla FATTURA_PV PV→agenzia)', () => {
    expect(
      canViewDocumentoFiscale(doc(null, 'agenzia1'), { companyId: 'broker1', isAdminPiattaforma: false }),
    ).toBe(false);
  });

  it('companyId assente e non admin → non visibile', () => {
    expect(canViewDocumentoFiscale(doc('broker1', null), { companyId: null, isAdminPiattaforma: false })).toBe(
      false,
    );
    expect(
      canViewDocumentoFiscale(doc('broker1', null), { companyId: undefined, isAdminPiattaforma: false }),
    ).toBe(false);
  });

  it('emittente PV (null) non rende visibile a chi ha companyId (no match su null)', () => {
    expect(
      canViewDocumentoFiscale(doc(null, 'agenzia1'), { companyId: 'broker1', isAdminPiattaforma: false }),
    ).toBe(false);
  });
});
