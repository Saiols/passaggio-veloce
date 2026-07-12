import { describe, it, expect } from 'vitest';
import { UserRole } from '@pv/db';
import { etichettaRuolo, type RuoloVisualizzato } from './ruoli';

const TUTTI_I_RUOLI = Object.values(UserRole) as string[];

/**
 * Etichetta attesa per ciascun ruolo di `UserRole`, senza una sede corrente
 * (`sedeRole: null`). `satisfies Record<UserRole, ...>` è deliberato: se
 * domani si aggiunge un valore a `UserRole` e questa mappa non lo classifica,
 * IL TYPECHECK DI QUESTO FILE FALLISCE — non un test che spera di accorgersene
 * a runtime. `pnpm test` non typecheck-a (usa esbuild), quindi questa rete
 * morde solo su `pnpm typecheck`: è lì che va verificata, non in vitest.
 */
const ETICHETTA_ATTESA_SENZA_SEDE = {
  ADMIN_PIATTAFORMA: 'Admin piattaforma',
  ASSISTENTE: 'Assistente',
  AD: 'Staff',
  CTO: 'Staff',
  CFO: 'Staff',
  SALES_MANAGER: 'Staff',
  SALES: 'Staff',
  ADMIN_AZIENDA: 'Titolare',
  UTENTE_AZIENDA: 'Operatore',
} satisfies Record<UserRole, RuoloVisualizzato>;

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

describe('invariante: ogni ruolo di UserRole produce ESATTAMENTE la sua etichetta', () => {
  // A differenza di un generico toBeTruthy() (che passa sempre: tutti i rami
  // di etichettaRuolo tornano string literal, mai ''), qui si confronta il
  // valore ESATTO atteso per ruolo. Una classificazione sbagliata (es. CTO
  // etichettato "Assistente" invece di "Staff") fa fallire QUESTO test.
  // Quello che questo test non può fare da solo — accorgersi di un valore
  // NUOVO aggiunto a UserRole e mai classificato — è compito del compilatore:
  // vedi ETICHETTA_ATTESA_SENZA_SEDE sopra e ETICHETTA_PER_RUOLO in ruoli.ts,
  // entrambe `satisfies Record<UserRole, ...>`. Prova rosso→verde eseguita a
  // mano (vedi report): rimuovendo una chiave da ETICHETTA_PER_RUOLO,
  // `pnpm typecheck` fallisce; ripristinata, torna verde.
  it.each(Object.entries(ETICHETTA_ATTESA_SENZA_SEDE))(
    '%s → %s (sedeRole null)',
    (role, atteso) => {
      expect(etichettaRuolo({ role, sedeRole: null })).toBe(atteso);
    },
  );

  it('la mappa di test copre lo stesso insieme di UserRole, niente ruoli dimenticati nel confronto', () => {
    expect(Object.keys(ETICHETTA_ATTESA_SENZA_SEDE).sort()).toEqual([...TUTTI_I_RUOLI].sort());
  });

  it('un ruolo sconosciuto (dato sporco) ricade su Operatore, mai su una stringa vuota', () => {
    expect(etichettaRuolo({ role: 'PIPPO', sedeRole: null })).toBe('Operatore');
    expect(etichettaRuolo({ role: undefined, sedeRole: null })).toBe('Operatore');
  });
});
