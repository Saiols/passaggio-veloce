import { describe, it, expect } from 'vitest';
import { BRAND, siteUrl } from './brand';

describe('BRAND', () => {
  it('ha tutti i campi anagrafici obbligatori popolati (no TODO)', () => {
    expect(BRAND.legalName).toBe('Passaggio Veloce SRL');
    expect(BRAND.shortName).toBe('Passaggio Veloce');
    expect(BRAND.url).toBe('https://passaggioveloce.it');
    expect(BRAND.email).toBe('info@passaggioveloce.it');
    expect(BRAND.vatId).toBe('14688390963');
    expect(BRAND.vatIdSchema).toBe('IT14688390963');
    expect(BRAND.phoneE164).toBe('+393462877310');
    expect(BRAND.themeColor).toBe('#0b1e3a');
  });

  it('indirizzo sede legale completo', () => {
    expect(BRAND.address.street).toBe('Via delle Querce 5');
    expect(BRAND.address.postalCode).toBe('20057');
    expect(BRAND.address.city).toBe('Assago');
    expect(BRAND.address.region).toBe('MI');
    expect(BRAND.address.countryCode).toBe('IT');
  });

  it('founder list contiene i due co-founder', () => {
    expect(BRAND.founders).toEqual(['Andrea Saino', 'Francesco Sioli']);
  });

  it('siteUrl normalizza il path', () => {
    expect(siteUrl('/')).toBe('https://passaggioveloce.it/');
    expect(siteUrl('/privacy')).toBe('https://passaggioveloce.it/privacy');
    expect(siteUrl('privacy')).toBe('https://passaggioveloce.it/privacy');
    expect(siteUrl()).toBe('https://passaggioveloce.it');
  });

  it('espone i dati legali/contatti per il footer email', () => {
    expect(BRAND.legalName).toBe('Passaggio Veloce SRL');
    expect(BRAND.piva).toBe('14688390963');
    expect(BRAND.sede).toBe('Via delle Querce 5 — 20057 Assago (MI)');
    expect(BRAND.supportEmail).toBe('assistenza@passaggioveloce.it');
    expect(BRAND.tel).toBe('+39 346 287 7310');
  });
});
