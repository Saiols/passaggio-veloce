import { describe, it, expect } from 'vitest';
import {
  organizationJsonLd,
  websiteJsonLd,
  webPageJsonLd,
  faqJsonLd,
  serviceJsonLd,
  breadcrumbJsonLd,
  softwareApplicationJsonLd,
  ORGANIZATION_ID,
  WEBSITE_ID,
} from './jsonLd';

describe('organizationJsonLd', () => {
  const org = organizationJsonLd();

  it('ha @context e @type corretti', () => {
    expect(org['@context']).toBe('https://schema.org');
    expect(org['@type']).toEqual(['Organization', 'ProfessionalService']);
  });

  it('ha @id riferibile da altri schema', () => {
    expect(org['@id']).toBe(ORGANIZATION_ID);
    expect(ORGANIZATION_ID).toBe('https://passaggioveloce.it/#organization');
  });

  it('include P.IVA in formato schema.org (con prefisso IT)', () => {
    expect(org.vatID).toBe('IT14688390963');
    expect(org.taxID).toBe('14688390963');
  });

  it('include indirizzo PostalAddress completo', () => {
    expect(org.address).toMatchObject({
      '@type': 'PostalAddress',
      streetAddress: 'Via delle Querce 5',
      postalCode: '20057',
      addressLocality: 'Assago',
      addressRegion: 'MI',
      addressCountry: 'IT',
    });
  });

  it('include ContactPoint con telefono e email', () => {
    expect(org.contactPoint).toMatchObject({
      '@type': 'ContactPoint',
      telephone: '+393462877310',
      email: 'info@passaggioveloce.it',
      contactType: 'customer service',
      availableLanguage: ['Italian'],
    });
  });

  it('include founder come array di Person', () => {
    expect(org.founder).toEqual([
      { '@type': 'Person', name: 'Andrea Saino' },
      { '@type': 'Person', name: 'Francesco Sioli' },
    ]);
  });
});

describe('websiteJsonLd', () => {
  const ws = websiteJsonLd();

  it('ha @type WebSite con SearchAction', () => {
    expect(ws['@type']).toBe('WebSite');
    expect(ws.potentialAction).toMatchObject({
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://passaggioveloce.it/?q={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    });
  });

  it('publisher riferisce Organization via @id', () => {
    expect(ws.publisher).toEqual({ '@id': ORGANIZATION_ID });
  });
});

describe('faqJsonLd', () => {
  it('mappa items in mainEntity con Question/Answer', () => {
    const faq = faqJsonLd([
      { q: 'Domanda 1?', a: 'Risposta 1.' },
      { q: 'Domanda 2?', a: 'Risposta 2.' },
    ]);
    expect(faq['@type']).toBe('FAQPage');
    expect(faq.mainEntity).toHaveLength(2);
    expect(faq.mainEntity[0]).toMatchObject({
      '@type': 'Question',
      name: 'Domanda 1?',
      acceptedAnswer: { '@type': 'Answer', text: 'Risposta 1.' },
    });
  });
});

describe('serviceJsonLd', () => {
  const svc = serviceJsonLd();

  it('@type Service con areaServed Italia', () => {
    expect(svc['@type']).toBe('Service');
    expect(svc.areaServed).toMatchObject({ '@type': 'Country', name: 'Italy' });
  });

  it('provider riferisce Organization via @id', () => {
    expect(svc.provider).toEqual({ '@id': ORGANIZATION_ID });
  });

  it('audience B2B', () => {
    expect(svc.audience).toMatchObject({ '@type': 'BusinessAudience' });
  });
});

describe('softwareApplicationJsonLd', () => {
  const sw = softwareApplicationJsonLd();

  it('@type SoftwareApplication categoria Business', () => {
    expect(sw['@type']).toBe('SoftwareApplication');
    expect(sw.applicationCategory).toBe('BusinessApplication');
    expect(sw.operatingSystem).toBe('Web');
  });

  it('offers gratuito EUR', () => {
    expect(sw.offers).toMatchObject({
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
    });
  });
});

describe('webPageJsonLd', () => {
  it('crea WebPage con campi base', () => {
    const wp = webPageJsonLd({
      url: 'https://passaggioveloce.it/privacy',
      name: 'Privacy Policy',
      description: 'Informativa privacy.',
    });
    expect(wp['@type']).toBe('WebPage');
    expect(wp.url).toBe('https://passaggioveloce.it/privacy');
    expect(wp.name).toBe('Privacy Policy');
    expect(wp.isPartOf).toEqual({ '@id': WEBSITE_ID });
  });
});

describe('breadcrumbJsonLd', () => {
  it('crea BreadcrumbList ordinata', () => {
    const bc = breadcrumbJsonLd([
      { name: 'Home', url: 'https://passaggioveloce.it/' },
      { name: 'Privacy', url: 'https://passaggioveloce.it/privacy' },
    ]);
    expect(bc['@type']).toBe('BreadcrumbList');
    expect(bc.itemListElement[0]).toMatchObject({ '@type': 'ListItem', position: 1, name: 'Home' });
    expect(bc.itemListElement[1].position).toBe(2);
  });
});
