import { describe, it, expect } from 'vitest';
import { isPublicPath, isGatedHost, isLandingOnlyHost, PUBLIC_PATHS } from './landing-gate';

describe('isPublicPath', () => {
  it('considera pubbliche le pagine legali storiche', () => {
    expect(isPublicPath('/privacy')).toBe(true);
    expect(isPublicPath('/cookie')).toBe(true);
    expect(isPublicPath('/termini')).toBe(true);
  });

  it('considera pubblica /privacy/clienti (informativa ex art.14 GDPR per venditori/acquirenti senza account)', () => {
    // Deve essere raggiungibile senza login: la raggiungono da un link nei
    // Termini (clausola 17.3) e dalle email dirette a persone che non hanno
    // un account sulla piattaforma. Se resta fuori dall'allowlist, il gate
    // (marketing pre-lancio E auth generico) la rimanda a /login.
    expect(isPublicPath('/privacy/clienti')).toBe(true);
  });

  it('non rende pubblici path arbitrari sotto /privacy/', () => {
    // Il fix deve aggiungere l'entry esatta, non aprire un intero sottoalbero.
    expect(isPublicPath('/privacy/altro-non-esistente')).toBe(false);
  });

  it('tutte le pagine legali note sono nell allowlist esatta o coperte da isPublicPath', () => {
    for (const p of ['/', '/privacy', '/cookie', '/termini', '/privacy/clienti']) {
      expect(isPublicPath(p)).toBe(true);
    }
  });

  it('/guide e i suoi sottopercorsi restano pubblici (comportamento esistente)', () => {
    expect(isPublicPath('/guide')).toBe(true);
    expect(isPublicPath('/guide/qualcosa')).toBe(true);
  });

  it('path non elencati restano privati', () => {
    expect(isPublicPath('/dashboard')).toBe(false);
    expect(isPublicPath('/random')).toBe(false);
  });
});

describe('PUBLIC_PATHS', () => {
  it('include /privacy/clienti come entry esatta', () => {
    expect(PUBLIC_PATHS.has('/privacy/clienti')).toBe(true);
  });
});

describe('isGatedHost', () => {
  it('riconosce i domini di produzione come gated', () => {
    expect(isGatedHost('passaggioveloce.it')).toBe(true);
    expect(isGatedHost('www.passaggioveloce.it')).toBe(true);
  });

  it('non considera gated gli host di preview/vercel', () => {
    expect(isGatedHost('passaggio-veloce-piattaforma.vercel.app')).toBe(false);
  });

  it('ignora la porta (dev/test)', () => {
    expect(isGatedHost('passaggioveloce.it:3000')).toBe(true);
  });

  it('gestisce host null/undefined', () => {
    expect(isGatedHost(null)).toBe(false);
    expect(isGatedHost(undefined)).toBe(false);
  });
});

describe('isLandingOnlyHost (gate app)', () => {
  // Go-live 2026-07-22: LANDING_ONLY=false → nessun host è in modalità vetrina,
  // l'app è servita ovunque. isGatedHost resta invariato (host-id per la SEO:
  // robots/sitemap/llms continuano a riconoscere passaggioveloce.it come prod).
  it('con LANDING_ONLY spento, nessun host è "solo vetrina"', () => {
    expect(isLandingOnlyHost('passaggioveloce.it')).toBe(false);
    expect(isLandingOnlyHost('www.passaggioveloce.it')).toBe(false);
    expect(isLandingOnlyHost('passaggio-veloce-piattaforma.vercel.app')).toBe(false);
    expect(isLandingOnlyHost(null)).toBe(false);
  });
});
