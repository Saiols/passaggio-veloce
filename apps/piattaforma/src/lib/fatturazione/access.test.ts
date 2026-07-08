import { describe, it, expect } from 'vitest';
import { canViewDocumentoFiscale } from './access';

// Comportamento company-level preesistente: equivale all'owner in vista
// aggregata (aggregate: true → vede tutta la madre, nessun filtro sede).
const AGGREGATE_ALL = { scopeIds: [], aggregate: true };

const doc = (emittenteCompanyId: string | null, destinatarioCompanyId: string | null) => ({
  emittenteCompanyId,
  destinatarioCompanyId,
});

describe('canViewDocumentoFiscale', () => {
  it('admin piattaforma vede qualsiasi documento', () => {
    expect(
      canViewDocumentoFiscale(doc(null, 'agenzia1'), {
        companyId: 'altro',
        isAdminPiattaforma: true,
        scope: AGGREGATE_ALL,
      }),
    ).toBe(true);
  });

  it('emittente == company del viewer → visibile', () => {
    expect(
      canViewDocumentoFiscale(doc('broker1', null), {
        companyId: 'broker1',
        isAdminPiattaforma: false,
        scope: AGGREGATE_ALL,
      }),
    ).toBe(true);
  });

  it('destinatario == company del viewer → visibile', () => {
    expect(
      canViewDocumentoFiscale(doc(null, 'agenzia1'), {
        companyId: 'agenzia1',
        isAdminPiattaforma: false,
        scope: AGGREGATE_ALL,
      }),
    ).toBe(true);
  });

  it('né emittente né destinatario → non visibile (es. broker sulla FATTURA_PV PV→agenzia)', () => {
    expect(
      canViewDocumentoFiscale(doc(null, 'agenzia1'), {
        companyId: 'broker1',
        isAdminPiattaforma: false,
        scope: AGGREGATE_ALL,
      }),
    ).toBe(false);
  });

  it('companyId assente e non admin → non visibile', () => {
    expect(
      canViewDocumentoFiscale(doc('broker1', null), {
        companyId: null,
        isAdminPiattaforma: false,
        scope: AGGREGATE_ALL,
      }),
    ).toBe(false);
    expect(
      canViewDocumentoFiscale(doc('broker1', null), {
        companyId: undefined,
        isAdminPiattaforma: false,
        scope: AGGREGATE_ALL,
      }),
    ).toBe(false);
  });

  it('emittente PV (null) non rende visibile a chi ha companyId (no match su null)', () => {
    expect(
      canViewDocumentoFiscale(doc(null, 'agenzia1'), {
        companyId: 'broker1',
        isAdminPiattaforma: false,
        scope: AGGREGATE_ALL,
      }),
    ).toBe(false);
  });
});

const docSede = (over: Partial<Parameters<typeof canViewDocumentoFiscale>[0]> = {}) => ({
  emittenteCompanyId: null,
  destinatarioCompanyId: 'c1',
  praticaAgenziaSedeId: null,
  praticaBrokerSedeId: null,
  payoutWalletSedeId: null,
  ...over,
});

describe('canViewDocumentoFiscale — scoping sede', () => {
  const aggregate = { scopeIds: ['s1', 's2'], aggregate: true };
  const membro = { scopeIds: ['s2'], aggregate: false };

  it("l'owner aggregato vede anche i documenti senza pratica né payout", () => {
    expect(
      canViewDocumentoFiscale(docSede(), { companyId: 'c1', isAdminPiattaforma: false, scope: aggregate }),
    ).toBe(true);
  });

  it('il membro vede la fattura della pratica della sua sede', () => {
    expect(
      canViewDocumentoFiscale(docSede({ praticaAgenziaSedeId: 's2' }), {
        companyId: 'c1',
        isAdminPiattaforma: false,
        scope: membro,
      }),
    ).toBe(true);
  });

  it("il membro NON vede la fattura di un'altra sede della stessa madre", () => {
    expect(
      canViewDocumentoFiscale(docSede({ praticaAgenziaSedeId: 's1' }), {
        companyId: 'c1',
        isAdminPiattaforma: false,
        scope: membro,
      }),
    ).toBe(false);
  });

  it('il membro vede il documento del payout del suo wallet sede', () => {
    expect(
      canViewDocumentoFiscale(docSede({ payoutWalletSedeId: 's2' }), {
        companyId: 'c1',
        isAdminPiattaforma: false,
        scope: membro,
      }),
    ).toBe(true);
  });

  it('il membro NON vede i documenti senza aggancio a sede', () => {
    expect(
      canViewDocumentoFiscale(docSede(), { companyId: 'c1', isAdminPiattaforma: false, scope: membro }),
    ).toBe(false);
  });

  it("l'admin piattaforma vede tutto, a prescindere dallo scope", () => {
    expect(
      canViewDocumentoFiscale(docSede(), { companyId: null, isAdminPiattaforma: true, scope: membro }),
    ).toBe(true);
  });
});
