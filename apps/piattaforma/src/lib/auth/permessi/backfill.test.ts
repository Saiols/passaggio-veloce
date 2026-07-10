import { describe, it, expect } from 'vitest';
import { permessiBackfill, decidiMembership } from './backfill';
import { permessiPerTipo, dipendenzaDi } from './catalogo';

describe('permessiBackfill', () => {
  it('un admin di sede riceve tutti i permessi del suo companyType', () => {
    expect(permessiBackfill('AGENZIA', 'ADMIN_SEDE').sort()).toEqual(permessiPerTipo('AGENZIA').sort());
    expect(permessiBackfill('DEALER', 'ADMIN_SEDE').sort()).toEqual(permessiPerTipo('DEALER').sort());
  });

  it("un operatore d'agenzia NON riceve pagamenti.iban né pagamenti.ritenta", () => {
    const p = permessiBackfill('AGENZIA', 'OPERATORE');
    expect(p).not.toContain('pagamenti.iban');
    expect(p).not.toContain('pagamenti.ritenta');
  });

  it("un operatore d'agenzia mantiene ciò che poteva fare: firma, segnala, inbox, xml", () => {
    const p = permessiBackfill('AGENZIA', 'OPERATORE');
    for (const k of [
      'pratiche.view',
      'pratiche.processa',
      'pratiche.firma',
      'pratiche.segnala',
      'pratiche.download',
      'inbox.view',
      'inbox.gestisci',
      'fatture.view',
      'fatture.download',
      'fatture.xml',
      'wallet.view',
      'addebiti.view',
      'affiliazione.view',
      'feedback.view',
      'orari.view',
      'notifiche.view',
    ]) {
      expect(p).toContain(k);
    }
    expect(p).toHaveLength(16);
  });

  it('un operatore dealer mantiene crea, annulla, valuta, xml', () => {
    const p = permessiBackfill('DEALER', 'OPERATORE');
    for (const k of [
      'pratiche.view',
      'pratiche.create',
      'pratiche.annulla',
      'pratiche.valuta',
      'pratiche.download',
      'fatture.view',
      'fatture.download',
      'fatture.xml',
      'wallet.view',
      'affiliazione.view',
      'notifiche.view',
    ]) {
      expect(p).toContain(k);
    }
    expect(p).toHaveLength(11);
  });

  it('nessun operatore riceve poteri gia oggi riservati: payout, soglia, sede, team, orari.edit', () => {
    for (const t of ['DEALER', 'AGENZIA'] as const) {
      const p = permessiBackfill(t, 'OPERATORE');
      for (const k of ['wallet.payout', 'wallet.soglia', 'sede.view', 'sede.edit', 'team.view']) {
        expect(p).not.toContain(k);
      }
    }
    expect(permessiBackfill('AGENZIA', 'OPERATORE')).not.toContain('orari.edit');
  });

  it('il set di backfill è chiuso rispetto alle dipendenze', () => {
    for (const t of ['DEALER', 'AGENZIA'] as const) {
      for (const r of ['ADMIN_SEDE', 'OPERATORE'] as const) {
        const set = permessiBackfill(t, r);
        for (const p of set) {
          const dip = dipendenzaDi(p);
          if (dip) expect(set).toContain(dip);
        }
      }
    }
  });
});

describe('decidiMembership', () => {
  it('zero membership → salta con motivo "nessuna membership di sede"', () => {
    const result = decidiMembership([]);
    expect(result).toEqual({ azione: 'salta', motivo: 'nessuna membership di sede' });
  });

  it('esattamente una con ruolo ADMIN_SEDE → scrivi ADMIN_SEDE', () => {
    const result = decidiMembership([{ ruolo: 'ADMIN_SEDE' }]);
    expect(result).toEqual({ azione: 'scrivi', ruolo: 'ADMIN_SEDE' });
  });

  it('esattamente una con ruolo OPERATORE → scrivi OPERATORE', () => {
    const result = decidiMembership([{ ruolo: 'OPERATORE' }]);
    expect(result).toEqual({ azione: 'scrivi', ruolo: 'OPERATORE' });
  });

  it('esattamente una con ruolo sconosciuto → salta con motivo "ruolo di sede sconosciuto: ..."', () => {
    const result = decidiMembership([{ ruolo: 'GUEST' }]);
    expect(result).toEqual({ azione: 'salta', motivo: 'ruolo di sede sconosciuto: GUEST' });
  });

  it('più di una membership → salta con motivo "<n> membership di sede (atteso 1)"', () => {
    const result = decidiMembership([
      { ruolo: 'ADMIN_SEDE' },
      { ruolo: 'OPERATORE' },
      { ruolo: 'ADMIN_SEDE' },
    ]);
    expect(result).toEqual({ azione: 'salta', motivo: '3 membership di sede (atteso 1)' });
  });
});
