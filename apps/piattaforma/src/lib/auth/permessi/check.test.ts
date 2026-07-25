import { describe, it, expect } from 'vitest';
import { can, assignablePermessi, validaPermessi, permessiPerNuovoUtente, type PermessiCtx } from './check';
import { permessiPerTipo, type Permesso } from './catalogo';
import { preset } from './preset';

const owner: PermessiCtx = { userId: 'owner1', isOwner: true, permessi: new Set(), soloLettura: false };
const adminSede = (permessi: Permesso[]): PermessiCtx => ({
  userId: 'admin1',
  isOwner: false,
  permessi: new Set(permessi),
  soloLettura: false,
});

/** Una chiave rimossa dal catalogo ma ancora presente su una riga vecchia del DB. */
const OBSOLETO = 'pratiche.tuttofare' as Permesso;

describe('can', () => {
  it("l'owner può tutto anche con il set vuoto", () => {
    expect(can(owner, 'wallet.payout')).toBe(true);
    expect(can(owner, 'sede.edit')).toBe(true);
  });

  it('un non-owner può solo ciò che ha nel set', () => {
    const ctx = adminSede(['fatture.view']);
    expect(can(ctx, 'fatture.view')).toBe(true);
    expect(can(ctx, 'fatture.download')).toBe(false);
  });

  it('una chiave non più nel catalogo è negata anche se il DB la contiene (fail-closed)', () => {
    // Un refuso scritto a mano non compila più: `can(ctx, 'wallet.payuot')` è un
    // errore di tipo. Resta il caso runtime: una riga vecchia del DB.
    expect(can(adminSede([OBSOLETO]), OBSOLETO)).toBe(false);
  });
});

describe('can — sola lettura da sospensione', () => {
  const ownerSospeso: PermessiCtx = {
    userId: 'owner1',
    isOwner: true,
    permessi: new Set(),
    soloLettura: true,
  };

  it("il titolare sospeso perde le chiavi di scrittura malgrado isOwner", () => {
    expect(can(ownerSospeso, 'pratiche.create')).toBe(false);
    expect(can(ownerSospeso, 'pratiche.firma')).toBe(false);
    expect(can(ownerSospeso, 'wallet.payout')).toBe(false);
    expect(can(ownerSospeso, 'sede.edit')).toBe(false);
    expect(can(ownerSospeso, 'team.permessi')).toBe(false);
  });

  it('il titolare sospeso conserva le chiavi di lettura', () => {
    expect(can(ownerSospeso, 'pratiche.view')).toBe(true);
    expect(can(ownerSospeso, 'wallet.view')).toBe(true);
    expect(can(ownerSospeso, 'fatture.xml')).toBe(true);
  });

  it('un non-owner sospeso conserva solo le chiavi di lettura che possedeva', () => {
    const ctx: PermessiCtx = {
      userId: 'u1',
      isOwner: false,
      permessi: new Set(['pratiche.view', 'pratiche.create']),
      soloLettura: true,
    };
    expect(can(ctx, 'pratiche.view')).toBe(true);
    expect(can(ctx, 'pratiche.create')).toBe(false);
  });

  it('un non-owner sospeso non guadagna chiavi di lettura che non aveva', () => {
    const ctx: PermessiCtx = {
      userId: 'u1',
      isOwner: false,
      permessi: new Set(['pratiche.view']),
      soloLettura: true,
    };
    expect(can(ctx, 'wallet.view')).toBe(false);
  });

  it('con soloLettura: false il comportamento è quello operativo normale (non regredire)', () => {
    const ctx: PermessiCtx = { userId: 'owner1', isOwner: true, permessi: new Set(), soloLettura: false };
    expect(can(ctx, 'wallet.payout')).toBe(true);
  });
});

describe('assignablePermessi', () => {
  it("l'owner può concedere tutto il catalogo del suo companyType", () => {
    expect(assignablePermessi(owner, 'AGENZIA').sort()).toEqual(permessiPerTipo('AGENZIA').sort());
  });

  it('un admin di sede può concedere esattamente i propri permessi', () => {
    const ctx = adminSede(['fatture.view', 'wallet.view', 'team.view', 'team.permessi']);
    expect(assignablePermessi(ctx, 'DEALER').sort()).toEqual(
      ['fatture.view', 'team.permessi', 'team.view', 'wallet.view'].sort(),
    );
  });

  it('un permesso solo-agenzia del chiamante non è assegnabile per un target DEALER', () => {
    const ctx = adminSede(['pratiche.view', 'pratiche.firma', 'fatture.view']);
    const assegnabili = assignablePermessi(ctx, 'DEALER');
    expect(assegnabili).not.toContain('pratiche.firma');
    expect(assegnabili.sort()).toEqual(['fatture.view', 'pratiche.view'].sort());
  });
});

describe('validaPermessi — anti-escalation', () => {
  const base = { companyType: 'AGENZIA', targetUserId: 'target1', targetRole: 'UTENTE_AZIENDA' } as const;

  it('rifiuta un permesso che il chiamante non possiede', () => {
    const ctx = adminSede(['team.view', 'team.permessi', 'fatture.view']);
    const res = validaPermessi({ ...base, ctx, richiesti: ['fatture.view', 'fatture.xml'] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('fatture.xml');
  });

  it('rifiuta una chiave sconosciuta', () => {
    const res = validaPermessi({ ...base, ctx: owner, richiesti: ['pratiche.tuttofare'] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('sconosciuto');
  });

  it('rifiuta una chiave valida ma di un altro companyType', () => {
    const res = validaPermessi({ ...base, ctx: owner, richiesti: ['pratiche.view', 'pratiche.create'] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('pratiche.create');
  });

  it('rifiuta un set con una dipendenza mancante', () => {
    const res = validaPermessi({ ...base, ctx: owner, richiesti: ['fatture.download'] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('richiede');
  });

  it('rifiuta la modifica dei propri permessi', () => {
    const ctx = adminSede(['team.view', 'team.permessi', 'fatture.view']);
    const res = validaPermessi({ ...base, ctx, targetUserId: 'admin1', richiesti: ['fatture.view'] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('tuoi permessi');
  });

  // Rilievo 2: la guardia è `targetUserId !== undefined && targetUserId === ctx.userId`,
  // non `targetUserId && ...`. Con la vecchia scrittura una stringa vuota è
  // falsy e la guardia non scatterebbe anche a parità di id (bug latente,
  // impatto nullo in pratica perché gli id reali sono uuid, ma qui lo
  // dimostriamo esplicitamente).
  it("rifiuta anche quando l'id è la stringa vuota (guardia per disuguaglianza, non per truthiness)", () => {
    const ctx: PermessiCtx = {
      userId: '',
      isOwner: false,
      permessi: new Set(['team.view', 'team.permessi', 'fatture.view']),
      soloLettura: false,
    };
    const res = validaPermessi({
      ctx,
      companyType: 'AGENZIA',
      targetUserId: '',
      targetRole: 'UTENTE_AZIENDA',
      richiesti: ['fatture.view'],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('tuoi permessi');
  });

  it("rifiuta la modifica dei permessi dell'owner", () => {
    const res = validaPermessi({ ...base, ctx: owner, targetRole: 'ADMIN_AZIENDA', richiesti: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('titolare');
  });

  it('rifiuta chi non ha team.permessi', () => {
    const ctx = adminSede(['team.view', 'team.crea', 'fatture.view']);
    const res = validaPermessi({ ...base, ctx, richiesti: ['fatture.view'] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('assegnare permessi');
  });

  it('accetta un set valido, deduplicato e ordinato', () => {
    const res = validaPermessi({
      ...base,
      ctx: owner,
      richiesti: ['fatture.download', 'fatture.view', 'fatture.view'],
    });
    expect(res).toEqual({ ok: true, permessi: ['fatture.download', 'fatture.view'] });
  });
});

describe('permessiPerNuovoUtente', () => {
  it('chi non ha team.permessi crea con il preset base intersecato ai propri permessi', () => {
    const ctx = adminSede(['team.view', 'team.crea', 'pratiche.view', 'pratiche.processa', 'notifiche.view']);
    const res = permessiPerNuovoUtente(ctx, 'AGENZIA');
    expect(res).toEqual({
      ok: true,
      permessi: ['notifiche.view', 'pratiche.processa', 'pratiche.view'],
    });
  });

  it('chi ha team.permessi ottiene esattamente ciò che ha chiesto', () => {
    const ctx = adminSede([...preset('ADMIN_SEDE', 'AGENZIA')]);
    const res = permessiPerNuovoUtente(ctx, 'AGENZIA', ['pratiche.view', 'pratiche.firma']);
    expect(res).toEqual({ ok: true, permessi: ['pratiche.firma', 'pratiche.view'] });
  });

  it("l'owner senza richiesta esplicita crea con il preset base completo", () => {
    const res = permessiPerNuovoUtente(owner, 'DEALER');
    expect(res).toEqual({ ok: true, permessi: preset('OPERATORE_BASE', 'DEALER').sort() });
  });

  it('poda i figli orfani se il set del creatore è già incoerente (ha pratiche.download ma non pratiche.view)', () => {
    const ctx = adminSede(['pratiche.download', 'notifiche.view']);
    const res = permessiPerNuovoUtente(ctx, 'AGENZIA');
    expect(res).toEqual({ ok: true, permessi: ['notifiche.view'] });
  });
});
