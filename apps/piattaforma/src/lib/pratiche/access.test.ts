import { describe, it, expect } from 'vitest';
import { canAccessDocumento, canAccessPratica } from './access';

/** Pratica del broker `b1` (sede `bs1`) assegnata all'agenzia `a1` (sede `as1`). */
const pratica = (over: Partial<Parameters<typeof canAccessPratica>[0]> = {}) => ({
  brokerId: 'b1',
  brokerSedeId: 'bs1' as string | null,
  agenziaAssegnataId: 'a1' as string | null,
  agenziaSedeId: 'as1' as string | null,
  ...over,
});

const NESSUNA_SEDE = { scopeIds: [], aggregate: false, isOwner: false };

describe('canAccessPratica', () => {
  it('admin piattaforma accede sempre (companyId undefined, scope vuoto)', () => {
    expect(
      canAccessPratica(pratica(), {
        companyId: undefined,
        isAdminPiattaforma: true,
        scope: NESSUNA_SEDE,
      }),
    ).toBe(true);
  });

  it('non-admin senza companyId → negato', () => {
    expect(
      canAccessPratica(pratica(), {
        companyId: undefined,
        isAdminPiattaforma: false,
        scope: { scopeIds: ['bs1'], aggregate: false, isOwner: true },
      }),
    ).toBe(false);
  });

  it('broker della stessa sede → accesso', () => {
    expect(
      canAccessPratica(pratica(), {
        companyId: 'b1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['bs1'], aggregate: false, isOwner: false },
      }),
    ).toBe(true);
  });

  it("broker di un'altra sede della stessa madre → negato", () => {
    expect(
      canAccessPratica(pratica(), {
        companyId: 'b1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['bs2'], aggregate: false, isOwner: false },
      }),
    ).toBe(false);
  });

  it('agenzia assegnata della stessa sede → accesso', () => {
    expect(
      canAccessPratica(pratica(), {
        companyId: 'a1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['as1'], aggregate: false, isOwner: false },
      }),
    ).toBe(true);
  });

  it("agenzia assegnata di un'altra sede → negato", () => {
    expect(
      canAccessPratica(pratica(), {
        companyId: 'a1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['as2'], aggregate: false, isOwner: false },
      }),
    ).toBe(false);
  });

  it('company estranea alla pratica → negato, anche con la sede in scope', () => {
    expect(
      canAccessPratica(pratica(), {
        companyId: 'estranea',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['bs1', 'as1'], aggregate: false, isOwner: true },
      }),
    ).toBe(false);
  });

  it('scopeIds vuoto → negato (fail-closed) per il membro di sede', () => {
    expect(
      canAccessPratica(pratica(), {
        companyId: 'b1',
        isAdminPiattaforma: false,
        scope: NESSUNA_SEDE,
      }),
    ).toBe(false);
  });

  it("scopeIds vuoto → negato (fail-closed) anche per il proprietario, in vista aggregata", () => {
    expect(
      canAccessPratica(pratica(), {
        companyId: 'b1',
        isAdminPiattaforma: false,
        scope: { scopeIds: [], aggregate: true, isOwner: true },
      }),
    ).toBe(false);
  });

  it('proprietario in vista ALL accede alle pratiche di tutte le sue sedi', () => {
    const ownerAll = {
      companyId: 'b1',
      isAdminPiattaforma: false,
      scope: { scopeIds: ['bs1', 'bs2'], aggregate: true, isOwner: true },
    };
    expect(canAccessPratica(pratica(), ownerAll)).toBe(true);
    expect(canAccessPratica(pratica({ brokerSedeId: 'bs2' }), ownerAll)).toBe(true);
  });

  it('proprietario in vista ALL non accede alla pratica di una sede non sua', () => {
    expect(
      canAccessPratica(pratica({ brokerSedeId: 'bs9' }), {
        companyId: 'b1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['bs1', 'bs2'], aggregate: true, isOwner: true },
      }),
    ).toBe(false);
  });

  it('pratica legacy con agenziaSedeId null → agenzia negata (nessun bypass aggregate)', () => {
    expect(
      canAccessPratica(pratica({ agenziaSedeId: null }), {
        companyId: 'a1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['as1'], aggregate: true, isOwner: true },
      }),
    ).toBe(false);
  });

  it('pratica legacy con brokerSedeId null → broker negato (nessun bypass aggregate)', () => {
    expect(
      canAccessPratica(pratica({ brokerSedeId: null }), {
        companyId: 'b1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['bs1'], aggregate: true, isOwner: true },
      }),
    ).toBe(false);
  });

  it('pratica non assegnata (agenziaAssegnataId null) → il broker in scope accede', () => {
    expect(
      canAccessPratica(pratica({ agenziaAssegnataId: null, agenziaSedeId: null }), {
        companyId: 'b1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['bs1'], aggregate: false, isOwner: false },
      }),
    ).toBe(true);
  });

  it('mai la sede della controparte: combacio come broker ma la mia sede è quella lato agenzia', () => {
    // `companyId` è il broker della pratica, ma il suo scope contiene solo
    // `as1`, che è la sede del LATO AGENZIA. Nessun accesso.
    expect(
      canAccessPratica(pratica(), {
        companyId: 'b1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['as1'], aggregate: false, isOwner: true },
      }),
    ).toBe(false);
  });

  it("mai la sede della controparte: combacio come agenzia ma la mia sede è quella lato broker", () => {
    expect(
      canAccessPratica(pratica(), {
        companyId: 'a1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['bs1'], aggregate: false, isOwner: true },
      }),
    ).toBe(false);
  });

  it('null non matcha una company: pratica non assegnata, sede agenzia IN scope → negato', () => {
    // La sede agenzia è in scope: il solo termine che può negare è
    // `agenziaAssegnataId === cid` (null !== 'x'). Se lo si cancellasse da
    // canAccessPratica, `inScope('as1')` concederebbe e questo test fallirebbe —
    // è ciò che lo rende non tautologico.
    expect(
      canAccessPratica(pratica({ agenziaAssegnataId: null, agenziaSedeId: 'as1' }), {
        companyId: 'x',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['as1'], aggregate: false, isOwner: true },
      }),
    ).toBe(false);
  });
});

/** Documento aziendale della company `b1` (visura / CI legale rappresentante). */
const docAziendale = (over: Partial<Parameters<typeof canAccessDocumento>[0]> = {}) => ({
  companyId: 'b1' as string | null,
  praticaId: null as string | null,
  pratica: null as Parameters<typeof canAccessDocumento>[0]['pratica'],
  ...over,
});

/** Documento agganciato alla pratica di `pratica()` (broker b1/bs1, agenzia a1/as1). */
const docPratica = (over: Partial<Parameters<typeof canAccessDocumento>[0]> = {}) => ({
  companyId: null as string | null,
  praticaId: 'p1' as string | null,
  pratica: pratica(),
  ...over,
});

describe('canAccessDocumento', () => {
  it('admin piattaforma accede sempre (anche al documento aziendale altrui)', () => {
    expect(
      canAccessDocumento(docAziendale({ companyId: 'altra' }), {
        companyId: undefined,
        isAdminPiattaforma: true,
        scope: NESSUNA_SEDE,
      }),
    ).toBe(true);
  });

  it('documento aziendale: proprietario in vista ONE → accesso', () => {
    expect(
      canAccessDocumento(docAziendale(), {
        companyId: 'b1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['bs1'], aggregate: false, isOwner: true },
      }),
    ).toBe(true);
  });

  it('documento aziendale: proprietario in vista ALL → accesso', () => {
    expect(
      canAccessDocumento(docAziendale(), {
        companyId: 'b1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['bs1', 'bs2'], aggregate: true, isOwner: true },
      }),
    ).toBe(true);
  });

  it('documento aziendale: OPERATORE della company → negato', () => {
    expect(
      canAccessDocumento(docAziendale(), {
        companyId: 'b1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['bs1'], aggregate: false, isOwner: false },
      }),
    ).toBe(false);
  });

  it('documento aziendale: ADMIN_SEDE (non proprietario) → negato', () => {
    // Il ruolo di sede non compare in `SedeScope`: ADMIN_SEDE e OPERATORE si
    // distinguono solo per `isOwner: false`. Il documento è della madre e nessun
    // ruolo di sede può rivendicarlo, nemmeno il titolare della filiale.
    expect(
      canAccessDocumento(docAziendale(), {
        companyId: 'b1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['bs1'], aggregate: false, isOwner: false },
      }),
    ).toBe(false);
  });

  it("documento aziendale di un'ALTRA company → negato anche al proprietario", () => {
    expect(
      canAccessDocumento(docAziendale({ companyId: 'altra' }), {
        companyId: 'b1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['bs1'], aggregate: true, isOwner: true },
      }),
    ).toBe(false);
  });

  it('documento aziendale: viewer senza company non matcha companyId null', () => {
    expect(
      canAccessDocumento(docAziendale({ companyId: null }), {
        companyId: undefined,
        isAdminPiattaforma: false,
        scope: { scopeIds: [], aggregate: false, isOwner: true },
      }),
    ).toBe(false);
  });

  it('documento di pratica: broker della sede della pratica → accesso', () => {
    expect(
      canAccessDocumento(docPratica(), {
        companyId: 'b1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['bs1'], aggregate: false, isOwner: false },
      }),
    ).toBe(true);
  });

  it("documento di pratica di un'ALTRA sede della stessa madre → negato", () => {
    expect(
      canAccessDocumento(docPratica(), {
        companyId: 'b1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['bs2'], aggregate: false, isOwner: false },
      }),
    ).toBe(false);
  });

  it('documento senza company e senza pratica → negato (nessuno può rivendicarlo)', () => {
    expect(
      canAccessDocumento({ companyId: null, praticaId: null, pratica: null }, {
        companyId: 'b1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['bs1'], aggregate: true, isOwner: true },
      }),
    ).toBe(false);
  });

  it('documento di pratica della propria company ma con relazione non caricata → negato', () => {
    // `praticaId` valorizzato ⇒ non è un documento aziendale; senza `pratica`
    // non c'è nulla da valutare: fail-closed, mai un grant silenzioso.
    expect(
      canAccessDocumento(docPratica({ companyId: 'b1', pratica: null }), {
        companyId: 'b1',
        isAdminPiattaforma: false,
        scope: { scopeIds: ['bs1'], aggregate: true, isOwner: true },
      }),
    ).toBe(false);
  });
});
