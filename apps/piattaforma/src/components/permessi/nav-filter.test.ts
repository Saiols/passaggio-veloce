import { describe, it, expect } from 'vitest';
import { vede, filtraGruppi, type NavCtx } from './nav-filter';
import type { Permesso } from '@/lib/auth/permessi/catalogo';

const operatore: NavCtx = {
  isOwner: false,
  permessi: ['pratiche.view', 'fatture.view'],
  soloLettura: false,
};
const owner: NavCtx = { isOwner: true, permessi: [], soloLettura: false };
/** Titolare sospeso: `permessi` resta vuoto perché `can()` gli darebbe tutto via isOwner. */
const ownerSospeso: NavCtx = { isOwner: true, permessi: [], soloLettura: true };

// Annotazione esplicita: senza, tsc non riesce a unificare un `T` unico su un
// array con voci eterogenee (alcune senza `permesso`, altre con chiavi diverse
// tra un gruppo e l'altro) — vedi le shell reali per lo stesso pattern.
type TestNavItem = { href: string; permesso?: Permesso };

describe('vede', () => {
  it('una voce senza permesso richiesto è sempre visibile', () => {
    expect(vede(operatore, undefined)).toBe(true);
  });

  it('una voce col permesso posseduto è visibile', () => {
    expect(vede(operatore, 'pratiche.view')).toBe(true);
  });

  it('una voce col permesso mancante è nascosta', () => {
    expect(vede(operatore, 'wallet.view')).toBe(false);
  });

  it("l'owner vede tutto, anche con l'elenco vuoto", () => {
    expect(vede(owner, 'wallet.payout')).toBe(true);
  });

  /**
   * MINOR M1: `vede()` era un `can()` riscritto a mano
   * (`ctx.isOwner || ctx.permessi.includes(p)`), quindi la sola lettura non lo
   * raggiungeva. Oggi nessuna voce di nav è gated su una chiave di scrittura, ma
   * la prima che lo sarà non deve comparire a un titolare sospeso — è la stessa
   * forma del bug già trovato una volta in questo branch.
   */
  it('titolare SOSPESO: una voce gated su una chiave di scrittura è nascosta', () => {
    expect(vede(ownerSospeso, 'wallet.payout')).toBe(false);
  });

  it('titolare SOSPESO: le voci gated su chiavi di lettura restano visibili', () => {
    expect(vede(ownerSospeso, 'wallet.view')).toBe(true);
  });

  it('titolare SOSPESO: una voce senza permesso resta visibile (Dashboard, Profilo)', () => {
    expect(vede(ownerSospeso, undefined)).toBe(true);
  });
});

describe('filtraGruppi', () => {
  const gruppi: { label: string; items: TestNavItem[] }[] = [
    { label: 'Panoramica', items: [{ href: '/dashboard' }] },
    {
      label: 'Finanze',
      items: [
        { href: '/wallet', permesso: 'wallet.view' as const },
        { href: '/fatturazione', permesso: 'fatture.view' as const },
      ],
    },
    { label: 'Crescita', items: [{ href: '/affiliazione', permesso: 'affiliazione.view' as const }] },
  ];

  it('scarta le voci negate e conserva le altre', () => {
    const out = filtraGruppi(gruppi, operatore);
    expect(out.find((g) => g.label === 'Finanze')?.items.map((i) => i.href)).toEqual(['/fatturazione']);
  });

  it('elimina i gruppi rimasti senza voci', () => {
    // «Crescita» conteneva solo affiliazione.view, che l'operatore non ha:
    // una label senza voci sotto sarebbe un buco nella sidebar.
    expect(filtraGruppi(gruppi, operatore).map((g) => g.label)).toEqual(['Panoramica', 'Finanze']);
  });

  it("all'owner non toglie nulla", () => {
    expect(filtraGruppi(gruppi, owner)).toEqual(gruppi);
  });

  it('a un titolare sospeso non toglie nulla: queste voci sono tutte di lettura', () => {
    // Il controllo che la sola lettura non sia diventata un filtro troppo largo:
    // la sidebar reale è fatta di chiavi `*.view`, e deve restare navigabile.
    expect(filtraGruppi(gruppi, ownerSospeso)).toEqual(gruppi);
  });

  it('non muta i gruppi in ingresso', () => {
    const prima = JSON.stringify(gruppi);
    filtraGruppi(gruppi, operatore);
    expect(JSON.stringify(gruppi)).toBe(prima);
  });
});
