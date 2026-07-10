import { describe, it, expect } from 'vitest';
import { preset, riconoscePreset } from './preset';
import { permessiPerTipo, dipendenzaDi } from './catalogo';

describe('preset', () => {
  it('ADMIN_SEDE contiene tutti i permessi del suo companyType', () => {
    expect(preset('ADMIN_SEDE', 'DEALER').sort()).toEqual(permessiPerTipo('DEALER').sort());
    expect(preset('ADMIN_SEDE', 'AGENZIA').sort()).toEqual(permessiPerTipo('AGENZIA').sort());
  });

  it('ogni preset contiene solo chiavi valide per il suo companyType', () => {
    for (const t of ['DEALER', 'AGENZIA'] as const) {
      const validi = permessiPerTipo(t);
      for (const id of ['OPERATORE_BASE', 'OPERATORE_COMPLETO', 'ADMIN_SEDE'] as const) {
        for (const p of preset(id, t)) expect(validi).toContain(p);
      }
    }
  });

  it('ogni preset è chiuso rispetto alle dipendenze', () => {
    for (const t of ['DEALER', 'AGENZIA'] as const) {
      for (const id of ['OPERATORE_BASE', 'OPERATORE_COMPLETO', 'ADMIN_SEDE'] as const) {
        const set = preset(id, t);
        for (const p of set) {
          const dip = dipendenzaDi(p);
          if (dip) expect(set).toContain(dip);
        }
      }
    }
  });

  it('OPERATORE_BASE dealer crea pratiche ma non vede il wallet', () => {
    const base = preset('OPERATORE_BASE', 'DEALER');
    expect(base).toContain('pratiche.create');
    expect(base).not.toContain('wallet.view');
    expect(base).not.toContain('team.view');
  });

  it('OPERATORE_BASE agenzia gestisce inbox ma non firma', () => {
    const base = preset('OPERATORE_BASE', 'AGENZIA');
    expect(base).toContain('inbox.gestisci');
    expect(base).toContain('pratiche.processa');
    expect(base).not.toContain('pratiche.firma');
  });

  it('OPERATORE_COMPLETO agenzia firma e segnala, ma non tocca IBAN né team', () => {
    const c = preset('OPERATORE_COMPLETO', 'AGENZIA');
    expect(c).toContain('pratiche.firma');
    expect(c).toContain('pratiche.segnala');
    expect(c).not.toContain('pagamenti.iban');
    expect(c).not.toContain('sede.iban');
    expect(c).not.toContain('team.view');
  });

  it('nessun preset di operatore contiene wallet.payout', () => {
    for (const t of ['DEALER', 'AGENZIA'] as const) {
      expect(preset('OPERATORE_BASE', t)).not.toContain('wallet.payout');
      expect(preset('OPERATORE_COMPLETO', t)).not.toContain('wallet.payout');
    }
  });

  it('riconoscePreset identifica un set che coincide, e null altrimenti', () => {
    expect(riconoscePreset(preset('OPERATORE_BASE', 'DEALER'), 'DEALER')).toBe('OPERATORE_BASE');
    expect(riconoscePreset(preset('ADMIN_SEDE', 'AGENZIA'), 'AGENZIA')).toBe('ADMIN_SEDE');
    expect(riconoscePreset(['pratiche.view'], 'DEALER')).toBeNull();
    expect(riconoscePreset([], 'DEALER')).toBeNull();
  });
});
