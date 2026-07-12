import { describe, it, expect } from 'vitest';
import { UserRole } from '@pv/db';
import { etichettaRuolo } from './ruoli';

const TUTTI_I_RUOLI = Object.values(UserRole) as string[];

describe('etichettaRuolo — azienda (broker/agenzia)', () => {
  it("il proprietario è 'Titolare', qualunque sede stia guardando", () => {
    expect(etichettaRuolo({ role: 'ADMIN_AZIENDA', sedeRole: 'OWNER' })).toBe('Titolare');
  });

  it("il proprietario resta 'Titolare' anche senza sede corrente (vista aggregata)", () => {
    // In vista ALL non c'è una sede su cui calcolare il ruolo di membership:
    // sedeRole è null, ma il titolare non diventa per questo un operatore.
    expect(etichettaRuolo({ role: 'ADMIN_AZIENDA', sedeRole: null })).toBe('Titolare');
  });

  it('il ruolo di un non-owner viene dalla membership della sede, non da User.role', () => {
    // User.role è UTENTE_AZIENDA per TUTTI i non-owner: da solo non distingue
    // un admin di sede da un operatore. La distinzione sta in UserSede.ruolo.
    expect(etichettaRuolo({ role: 'UTENTE_AZIENDA', sedeRole: 'ADMIN_SEDE' })).toBe('Admin di sede');
    expect(etichettaRuolo({ role: 'UTENTE_AZIENDA', sedeRole: 'OPERATORE' })).toBe('Operatore');
  });

  it("un non-owner senza sede accessibile ricade su 'Operatore'", () => {
    expect(etichettaRuolo({ role: 'UTENTE_AZIENDA', sedeRole: null })).toBe('Operatore');
  });
});

describe('etichettaRuolo — staff di piattaforma', () => {
  it('admin e assistente hanno le proprie etichette', () => {
    expect(etichettaRuolo({ role: 'ADMIN_PIATTAFORMA', sedeRole: null })).toBe('Admin piattaforma');
    expect(etichettaRuolo({ role: 'ASSISTENTE', sedeRole: null })).toBe('Assistente');
  });

  it("i ruoli CRM interni sono 'Staff'", () => {
    for (const r of ['AD', 'CTO', 'CFO', 'SALES_MANAGER', 'SALES']) {
      expect(etichettaRuolo({ role: r, sedeRole: null })).toBe('Staff');
    }
  });

  it("lo staff non eredita mai il ruolo di sede (non ne ha una)", () => {
    // Difesa: anche passando per errore un sedeRole, l'admin resta admin.
    expect(etichettaRuolo({ role: 'ADMIN_PIATTAFORMA', sedeRole: 'OPERATORE' })).toBe(
      'Admin piattaforma',
    );
  });
});

describe('invariante: nessun ruolo può produrre una card vuota', () => {
  // Se domani si aggiunge un valore a UserRole e nessuno lo classifica qui,
  // la sidebar mostrerebbe una riga vuota. Questo test diventa rosso prima.
  it.each(TUTTI_I_RUOLI)("%s produce un'etichetta non vuota", (role) => {
    const label = etichettaRuolo({ role, sedeRole: null });
    expect(label).toBeTruthy();
    expect(label.trim().length).toBeGreaterThan(0);
  });

  it('anche un ruolo sconosciuto (dato sporco) non lascia la card vuota', () => {
    expect(etichettaRuolo({ role: 'PIPPO', sedeRole: null })).toBeTruthy();
    expect(etichettaRuolo({ role: undefined, sedeRole: null })).toBeTruthy();
  });
});
