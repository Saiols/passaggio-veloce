import { BRAND, siteUrl } from './brand';
import type { FaqItem } from './faqItems';

export const ORGANIZATION_ID = `${BRAND.url}/#organization`;
export const WEBSITE_ID = `${BRAND.url}/#website`;

const ADDRESS = {
  '@type': 'PostalAddress' as const,
  streetAddress: BRAND.address.street,
  postalCode: BRAND.address.postalCode,
  addressLocality: BRAND.address.city,
  addressRegion: BRAND.address.region,
  addressCountry: BRAND.address.countryCode,
};

export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': ['Organization', 'ProfessionalService'] as const,
    '@id': ORGANIZATION_ID,
    name: BRAND.shortName,
    legalName: BRAND.legalName,
    url: BRAND.url,
    logo: {
      '@type': 'ImageObject' as const,
      url: siteUrl('/brand/logo-primary.svg'),
    },
    image: siteUrl('/opengraph-image'),
    description: BRAND.description,
    email: BRAND.email,
    telephone: BRAND.phoneE164,
    vatID: BRAND.vatIdSchema,
    taxID: BRAND.taxId,
    address: ADDRESS,
    contactPoint: {
      '@type': 'ContactPoint' as const,
      telephone: BRAND.phoneE164,
      email: BRAND.email,
      contactType: 'customer service',
      availableLanguage: ['Italian'],
      areaServed: 'IT',
    },
    founder: BRAND.founders.map((name) => ({
      '@type': 'Person' as const,
      name,
    })),
    sameAs: BRAND.sameAs,
  };
}

export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite' as const,
    '@id': WEBSITE_ID,
    url: BRAND.url,
    name: BRAND.shortName,
    description: BRAND.description,
    inLanguage: 'it-IT',
    publisher: { '@id': ORGANIZATION_ID },
    potentialAction: {
      '@type': 'SearchAction' as const,
      target: {
        '@type': 'EntryPoint' as const,
        urlTemplate: `${BRAND.url}/?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function webPageJsonLd(opts: {
  url: string;
  name: string;
  description: string;
  lastModified?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage' as const,
    '@id': opts.url,
    url: opts.url,
    name: opts.name,
    description: opts.description,
    inLanguage: 'it-IT',
    isPartOf: { '@id': WEBSITE_ID },
    ...(opts.lastModified && { dateModified: opts.lastModified }),
  };
}

export function faqJsonLd(items: readonly FaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage' as const,
    mainEntity: items.map((item) => ({
      '@type': 'Question' as const,
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer' as const,
        text: item.a,
      },
    })),
  };
}

export function serviceJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service' as const,
    name: 'Broker digitale per passaggi di proprietà veicoli',
    serviceType: 'Intermediazione passaggi di proprietà auto',
    description: BRAND.description,
    provider: { '@id': ORGANIZATION_ID },
    areaServed: {
      '@type': 'Country' as const,
      name: 'Italy',
    },
    audience: {
      '@type': 'BusinessAudience' as const,
      audienceType: 'Concessionarie auto e agenzie pratiche auto',
    },
    offers: {
      '@type': 'Offer' as const,
      price: '0',
      priceCurrency: 'EUR',
      description: 'Registrazione gratuita, paghi solo a pratica completata',
    },
  };
}

export function softwareApplicationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication' as const,
    name: BRAND.shortName,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: BRAND.url,
    description: BRAND.description,
    publisher: { '@id': ORGANIZATION_ID },
    offers: {
      '@type': 'Offer' as const,
      price: '0',
      priceCurrency: 'EUR',
    },
  };
}

export function breadcrumbJsonLd(items: readonly { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList' as const,
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem' as const,
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
