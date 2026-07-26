// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CookieBanner, riapriPreferenzeCookie } from './cookie-banner';
import { COOKIE_CONSENT_STORAGE_KEY, parseConsent } from '@/lib/analytics/consent';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

let root: Root | null = null;
let host: HTMLElement | null = null;

function render(node: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

function clicca(testo: string) {
  const bottone = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === testo,
  );
  if (!bottone) throw new Error(`Bottone "${testo}" non trovato nel banner`);
  act(() => {
    bottone.click();
  });
}

const bannerVisibile = (): boolean => document.body.textContent?.includes('Cookie e privacy') ?? false;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/**
 * Il banner è il gate di Google Analytics: il flag `analytics` che salva qui è
 * esattamente quello che `GoogleAnalytics` legge per decidere se caricare il
 * tag. Un difetto in questo componente non si manifesta come errore — si
 * manifesta come tracciamento senza consenso, o come consenso raccolto e mai
 * onorato. Nessuno dei due rompe un test di logica pura.
 */
describe('CookieBanner', () => {
  it('nessuna scelta salvata → il banner è a video', () => {
    render(<CookieBanner />);
    expect(bannerVisibile()).toBe(true);
  });

  it('«Solo necessari» → salva analytics false e chiude il banner', () => {
    render(<CookieBanner />);
    clicca('Solo necessari');

    const salvato = parseConsent(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY));
    expect(salvato).toMatchObject({ analytics: false, marketing: false, essenziali: true });
    expect(bannerVisibile()).toBe(false);
  });

  it('«Accetta tutti» → salva analytics true e chiude il banner', () => {
    render(<CookieBanner />);
    clicca('Accetta tutti');

    expect(
      parseConsent(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)),
    ).toMatchObject({ analytics: true, marketing: true });
    expect(bannerVisibile()).toBe(false);
  });

  it('registra il momento del consenso in ISO 8601 (serve a dimostrare QUANDO)', () => {
    render(<CookieBanner />);
    clicca('Accetta tutti');

    const ts = parseConsent(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY))?.ts ?? '';
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it('«Personalizza» → si possono accettare le statistiche senza il marketing', () => {
    render(<CookieBanner />);
    clicca('Personalizza');

    const toggleAnalytics = document.querySelector('button[aria-label="Analytics"]');
    expect(toggleAnalytics).not.toBeNull();
    act(() => {
      (toggleAnalytics as HTMLButtonElement).click();
    });
    clicca('Salva preferenze');

    expect(
      parseConsent(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)),
    ).toMatchObject({ analytics: true, marketing: false });
  });

  it('una scelta già salvata → il banner non si ripresenta', () => {
    window.localStorage.setItem(
      COOKIE_CONSENT_STORAGE_KEY,
      '{"essenziali":true,"analytics":false,"marketing":false,"ts":"2026-07-26T00:00:00.000Z"}',
    );
    render(<CookieBanner />);
    expect(bannerVisibile()).toBe(false);
  });

  it('revoca dalla cookie policy → il banner torna a video SENZA ricaricare la pagina', () => {
    // Regressione mirata: la visibilità era governata da uno stato locale
    // `dismissed`, che restava true per tutta la vita della pagina. Il pulsante
    // "Gestisci le preferenze cookie" svuotava lo storage e non succedeva
    // nulla di visibile — cioè la revoca, che l'art. 7.3 GDPR vuole facile
    // quanto il consenso, era di fatto irraggiungibile.
    render(<CookieBanner />);
    clicca('Accetta tutti');
    expect(bannerVisibile()).toBe(false);

    act(() => {
      riapriPreferenzeCookie();
    });

    expect(bannerVisibile()).toBe(true);
    expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBeNull();
  });

  it('il banner nomina Google Analytics: senza, il consenso non è informato', () => {
    render(<CookieBanner />);
    expect(document.body.textContent).toContain('Google Analytics');
  });
});
