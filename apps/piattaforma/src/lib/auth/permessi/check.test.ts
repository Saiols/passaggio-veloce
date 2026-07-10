import { describe, it, expect } from 'vitest';
import { can, assignablePermessi, validaPermessi, permessiPerNuovoUtente, type PermessiCtx } from './check';
import { permessiPerTipo, type Permesso } from './catalogo';
import { preset } from './preset';

const owner: PermessiCtx = { userId: 'owner1', isOwner: true, permessi: new Set() };
const adminSede = (permessi: Permesso[]): PermessiCtx => ({
  userId: 'admin1',
  isOwner: false,
  permessi: new Set(permessi),
});

/** Una chiave rimossa dal catalogo ma ancora presente su una riga vecchia del DB. */
const OBSOLETO = 'pratiche.tuttofare' as Permesso;

describe('can', () => {
  it("l'owner può tutto anche con il set vuoto", () => {
    expect(can(owner, 'wallet.payout')).toBe(true);
    expect(can(owner, 'sede.iban')).toBe(true);
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
});

describe('validaPermessi — anti-escalation', () => {
  const base = { companyType: 'AGENZIA' as const, targetUserId: 'target1', targetRole: 'UTENTE_AZIENDA' };

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
});
