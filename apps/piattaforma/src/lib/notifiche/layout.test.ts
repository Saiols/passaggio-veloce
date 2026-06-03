import { describe, it, expect } from 'vitest';
import { emailLayout, ctaButton, unsubscribeFooterLine } from './layout';

describe('emailLayout', () => {
  const out = emailLayout('<h1>Ciao</h1>');

  it('inserisce il corpo dentro la card', () => {
    expect(out).toContain('<h1>Ciao</h1>');
  });
  it('usa header navy + keyline arancio (table-based, niente flex)', () => {
    expect(out).toContain('#0a2540');
    expect(out).toContain('#ff7a00');
    expect(out).not.toContain('display:flex');
  });
  it('referenzia il logo PNG via URL assoluto con alt', () => {
    expect(out).toContain('https://passaggioveloce.it/brand/logo-email.png');
    expect(out).toContain('alt="Passaggio Veloce"');
  });
  it('footer con dati legali completi', () => {
    expect(out).toContain('Passaggio Veloce SRL');
    expect(out).toContain('14688390963');
    expect(out).toContain('Via delle Querce 5');
    expect(out).toContain('assistenza@passaggioveloce.it');
    expect(out).toContain('+39 346 287 7310');
  });
  it('include il token unsubscribe per iniezione da send.ts', () => {
    expect(out).toContain('<!--PV_UNSUB-->');
  });
});

describe('ctaButton', () => {
  it('rende un bottone arancio con href e label', () => {
    const b = ctaButton('https://x.it/p', 'Valuta →');
    expect(b).toContain('https://x.it/p');
    expect(b).toContain('Valuta →');
    expect(b).toContain('#ff7a00');
  });
  it('fa escaping di href e label', () => {
    const b = ctaButton('https://x.it/?a=1&b=2', '<script>');
    expect(b).toContain('a=1&amp;b=2');
    expect(b).not.toContain('<script>');
  });
});

describe('unsubscribeFooterLine', () => {
  it('contiene link disiscrizione e preferenze', () => {
    const l = unsubscribeFooterLine('https://x.it/u?t=1', 'https://x.it/profilo/notifiche');
    expect(l).toContain('https://x.it/u?t=1');
    expect(l).toContain('https://x.it/profilo/notifiche');
    expect(l).toContain('Disiscriviti');
    expect(l).toContain('Preferenze');
  });
});
