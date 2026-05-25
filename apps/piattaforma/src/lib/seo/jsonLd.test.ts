import { describe, it, expect } from 'vitest';
import {
  organizationJsonLd,
  websiteJsonLd,
  webPageJsonLd,
  faqJsonLd,
  serviceJsonLd,
  breadcrumbJsonLd,
  softwareApplicationJsonLd,
  articleJsonLd,
  howToJsonLd,
  collectionPageJsonLd,
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
    expect(wp['@id']).toBe('https://passaggioveloce.it/privacy');
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

describe('articleJsonLd', () => {
  const art = articleJsonLd({
    url: 'https://passaggioveloce.it/guide/costi-passaggio-proprieta',
    headline: 'Costi del passaggio di proprietà auto 2026',
    description: 'Quanto costa il passaggio nel 2026.',
    datePublished: '2026-05-25',
    dateModified: '2026-05-25',
  });

  it('@type Article con @id = url', () => {
    expect(art['@type']).toBe('Article');
    expect(art['@id']).toBe('https://passaggioveloce.it/guide/costi-passaggio-proprieta');
    expect(art.url).toBe('https://passaggioveloce.it/guide/costi-passaggio-proprieta');
  });

  it('author e publisher referenzia Organization', () => {
    expect(art.author).toEqual({ '@id': ORGANIZATION_ID });
    expect(art.publisher).toEqual({ '@id': ORGANIZATION_ID });
  });

  it('isPartOf riferisce WebSite, inLanguage it-IT', () => {
    expect(art.isPartOf).toEqual({ '@id': WEBSITE_ID });
    expect(art.inLanguage).toBe('it-IT');
  });

  it('image fallback a /opengraph-image se non fornita', () => {
    expect(art.image).toBe('https://passaggioveloce.it/opengraph-image');
  });

  it('image custom rispettata se fornita', () => {
    const withImage = articleJsonLd({
      url: 'https://passaggioveloce.it/guide/x',
      headline: 'X',
      description: 'X',
      datePublished: '2026-05-25',
      dateModified: '2026-05-25',
      imageUrl: 'https://passaggioveloce.it/custom.png',
    });
    expect(withImage.image).toBe('https://passaggioveloce.it/custom.png');
  });
});

describe('howToJsonLd', () => {
  const hw = howToJsonLd({
    url: 'https://passaggioveloce.it/guide/come-fare-passaggio-di-proprieta',
    name: 'Come fare il passaggio di proprietà',
    description: 'Procedura in 5 step.',
    totalTime: 'PT2D',
    estimatedCostEUR: '50-150',
    supplies: ['Carta d\'identità', 'Codice fiscale'],
    tools: ['SPID'],
    steps: [
      { title: 'Accordo e dichiarazione di vendita', body: 'Il venditore e l\'acquirente firmano la DT.' },
      { title: 'Raccolta documenti', body: 'Servono CI, CF, libretto.' },
    ],
  });

  it('@type HowTo con @id = url, totalTime ISO 8601', () => {
    expect(hw['@type']).toBe('HowTo');
    expect(hw['@id']).toBe('https://passaggioveloce.it/guide/come-fare-passaggio-di-proprieta');
    expect(hw.totalTime).toBe('PT2D');
  });

  it('estimatedCost MonetaryAmount EUR', () => {
    expect(hw.estimatedCost).toMatchObject({
      '@type': 'MonetaryAmount',
      currency: 'EUR',
      value: '50-150',
    });
  });

  it('supply mappata in HowToSupply array', () => {
    expect(hw.supply).toEqual([
      { '@type': 'HowToSupply', name: 'Carta d\'identità' },
      { '@type': 'HowToSupply', name: 'Codice fiscale' },
    ]);
  });

  it('tool mappato in HowToTool', () => {
    expect(hw.tool).toEqual([{ '@type': 'HowToTool', name: 'SPID' }]);
  });

  it('step con position 1-based, url ancorato', () => {
    expect(hw.step).toHaveLength(2);
    expect(hw.step[0]).toMatchObject({
      '@type': 'HowToStep',
      position: 1,
      name: 'Accordo e dichiarazione di vendita',
      url: 'https://passaggioveloce.it/guide/come-fare-passaggio-di-proprieta#step-1',
    });
    expect(hw.step[1].position).toBe(2);
    expect(hw.step[1].url).toBe('https://passaggioveloce.it/guide/come-fare-passaggio-di-proprieta#step-2');
  });

  it('omette estimatedCost/supply/tool se non forniti', () => {
    const minimal = howToJsonLd({
      url: 'https://x.it/guide/y',
      name: 'Y',
      description: 'd',
      totalTime: 'PT1H',
      steps: [{ title: 's', body: 'b' }],
    });
    expect(minimal.estimatedCost).toBeUndefined();
    expect(minimal.supply).toBeUndefined();
    expect(minimal.tool).toBeUndefined();
  });
});

describe('collectionPageJsonLd', () => {
  const cp = collectionPageJsonLd({
    url: 'https://passaggioveloce.it/guide',
    name: 'Guide',
    description: 'Lista guide.',
    items: [
      { url: 'https://passaggioveloce.it/guide/x', name: 'Guida X' },
      { url: 'https://passaggioveloce.it/guide/y', name: 'Guida Y' },
    ],
  });

  it('@type CollectionPage con @id = url', () => {
    expect(cp['@type']).toBe('CollectionPage');
    expect(cp['@id']).toBe('https://passaggioveloce.it/guide');
  });

  it('mainEntity ItemList con ListItem position 1-based', () => {
    expect(cp.mainEntity['@type']).toBe('ItemList');
    expect(cp.mainEntity.itemListElement).toHaveLength(2);
    expect(cp.mainEntity.itemListElement[0]).toMatchObject({
      '@type': 'ListItem',
      position: 1,
      url: 'https://passaggioveloce.it/guide/x',
      name: 'Guida X',
    });
    expect(cp.mainEntity.itemListElement[1].position).toBe(2);
  });

  it('isPartOf riferisce WebSite', () => {
    expect(cp.isPartOf).toEqual({ '@id': WEBSITE_ID });
  });
});
