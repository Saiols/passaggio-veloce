import { describe, it, expect } from 'vitest';
import { gruppiBroker, gruppiAgenzia, type NavInput, type GruppoNav } from './nav-voci';

function hrefs(gruppi: GruppoNav[]): string[] {
  return gruppi.flatMap((g) => g.items.map((i) => i.href));
}

function labels(gruppi: GruppoNav[]): string[] {
  return gruppi.map((g) => g.label);
}

/**
 * Le stesse 7 regole valgono per broker e agenzia (Team, Dashboard/Profilo,
 * Sedi, gruppi vuoti): un `describe` per funzione, stessi casi, per non
 * lasciare l'una coperta e l'altra no.
 */
function eseguiCasiComuni(nome: string, fn: (input: NavInput) => GruppoNav[]) {
  describe(nome, () => {
    it('un owner con permessi: [] e puoGestireTeam: true vede Team', () => {
      const input: NavInput = { isOwner: true, permessi: [], puoGestireTeam: true, soloLettura: false };
      expect(hrefs(fn(input))).toContain('/team');
    });

    it('un utente con team.view e puoGestireTeam: false NON vede Team (il caso che oggi manca)', () => {
      const input: NavInput = { isOwner: false, permessi: ['team.view'], puoGestireTeam: false, soloLettura: false };
      expect(hrefs(fn(input))).not.toContain('/team');
    });

    it('un utente con puoGestireTeam: true ma senza team.view non vede Team', () => {
      const input: NavInput = { isOwner: false, permessi: [], puoGestireTeam: true, soloLettura: false };
      expect(hrefs(fn(input))).not.toContain('/team');
    });

    it('un utente con team.view e puoGestireTeam: true vede Team', () => {
      const input: NavInput = { isOwner: false, permessi: ['team.view'], puoGestireTeam: true, soloLettura: false };
      expect(hrefs(fn(input))).toContain('/team');
    });

    it('Dashboard e Profilo compaiono sempre, anche con permessi: [] e non-owner', () => {
      const input: NavInput = { isOwner: false, permessi: [], puoGestireTeam: false, soloLettura: false };
      const h = hrefs(fn(input));
      expect(h).toContain('/dashboard');
      expect(h).toContain('/profilo');
    });

    it('Sedi compare solo per l\'owner', () => {
      const ownerInput: NavInput = { isOwner: true, permessi: [], puoGestireTeam: false, soloLettura: false };
      const nonOwnerInput: NavInput = { isOwner: false, permessi: ['sede.view'], puoGestireTeam: false, soloLettura: false };
      expect(hrefs(fn(ownerInput))).toContain('/sedi');
      expect(hrefs(fn(nonOwnerInput))).not.toContain('/sedi');
    });

    it('un gruppo che perde tutte le voci sparisce (Crescita, senza affiliazione.view)', () => {
      const input: NavInput = { isOwner: false, permessi: [], puoGestireTeam: false, soloLettura: false };
      expect(labels(fn(input))).not.toContain('Crescita');
    });
  });
}

eseguiCasiComuni('gruppiBroker', gruppiBroker);
eseguiCasiComuni('gruppiAgenzia', gruppiAgenzia);

describe('voci solo-agenzia', () => {
  it('Inbox, Addebiti, Feedback, Orari non compaiono in gruppiBroker', () => {
    // Input "massimale": anche con l'owner (che vede tutto ciò che esiste),
    // queste voci non devono comparire perché gruppiBroker non le costruisce
    // affatto — non è un filtro sui permessi, è struttura.
    const input: NavInput = { isOwner: true, permessi: [], puoGestireTeam: true, soloLettura: false };
    const h = hrefs(gruppiBroker(input));
    expect(h).not.toContain('/inbox');
    expect(h).not.toContain('/addebiti');
    expect(h).not.toContain('/feedback');
    expect(h).not.toContain('/orari');
  });
});
