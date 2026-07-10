import { describe, it, expect } from 'vitest';
import { vede, filtraGruppi, type NavCtx } from './nav-filter';
import type { Permesso } from '@/lib/auth/permessi/catalogo';

const operatore: NavCtx = { isOwner: false, permessi: ['pratiche.view', 'fatture.view'] };
const owner: NavCtx = { isOwner: true, permessi: [] };

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

  it('non muta i gruppi in ingresso', () => {
    const prima = JSON.stringify(gruppi);
    filtraGruppi(gruppi, operatore);
    expect(JSON.stringify(gruppi)).toBe(prima);
  });
});
