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
});
