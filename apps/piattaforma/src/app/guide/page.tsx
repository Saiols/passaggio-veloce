import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Breadcrumbs } from '@/components/guide/Breadcrumbs';
import { GuideFooterCta } from '@/components/guide/GuideFooterCta';
import { JsonLd } from '@/lib/seo/JsonLdScript';
import { GUIDES } from '@/lib/seo/guides';
import { siteUrl } from '@/lib/seo/brand';
import { collectionPageJsonLd } from '@/lib/seo/jsonLd';

export const metadata: Metadata = {
  title: 'Guide ai passaggi di proprietà auto',
  description:
    'Guide complete e aggiornate sui passaggi di proprietà: come fare, costi 2026, documenti necessari. Utile per privati, dealer e agenzie pratiche.',
  alternates: { canonical: '/guide' },
  openGraph: {
    title: 'Guide ai passaggi di proprietà auto · Passaggio Veloce',
    description:
      'Guide complete e aggiornate sui passaggi di proprietà auto: procedura, costi, documenti.',
    url: '/guide',
  },
};

export default function GuideHubPage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <JsonLd
        data={collectionPageJsonLd({
          url: siteUrl('/guide'),
          name: 'Guide ai passaggi di proprietà auto',
          description: 'Lista delle guide pillar di Passaggio Veloce.',
          items: GUIDES.map((g) => ({ url: siteUrl(g.url), name: g.title })),
        })}
      />
      <Breadcrumbs
        items={[
          { name: 'Home', url: siteUrl('/') },
          { name: 'Guide', url: siteUrl('/guide') },
        ]}
      />

      <section className="mx-auto w-full max-w-4xl px-5 pb-8 pt-8 sm:px-6 sm:pt-12">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-pv-navy-600/20 bg-pv-navy-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-pv-navy-700">
            <span className="h-1.5 w-1.5 rounded-full bg-pv-orange-500" />
            Risorse
          </span>
          <h1 className="mt-4 text-[32px] font-extrabold leading-tight tracking-tight text-pv-navy-900 sm:text-[40px]">
            Tutto quello che devi sapere sui{' '}
            <span className="text-pv-navy-700">passaggi di proprietà</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed text-pv-slate-700">
            Guide chiare e aggiornate al 2026 per privati, concessionari e agenzie pratiche.
            Procedura, costi, documenti: tutto in un posto solo.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-5 pb-12 sm:px-6">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {GUIDES.map((g) => (
            <Link
              key={g.slug}
              href={g.url}
              className="group flex h-full flex-col rounded-[16px] border border-pv-slate-200 bg-white p-6 transition-colors hover:border-pv-navy-300 hover:bg-pv-navy-50"
            >
              <span className="text-[11px] font-bold uppercase tracking-wider text-pv-orange-500">
                {g.category}
              </span>
              <h2 className="mt-2 text-[18px] font-bold leading-snug text-pv-navy-900 group-hover:text-pv-navy-700">
                {g.title}
              </h2>
              <p className="mt-3 flex-1 text-[13.5px] leading-relaxed text-pv-slate-500">
                {g.metaDescription}
              </p>
              <p className="mt-4 text-[12px] font-medium text-pv-slate-500">
                {g.readingTimeMin} min · Aggiornata {g.lastModified} →
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-pv-slate-50">
        <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-6 sm:py-16">
          <h2 className="text-[22px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[26px]">
            Perché scegliere un broker digitale?
          </h2>
          <ul className="mt-5 space-y-3 text-[14.5px] leading-relaxed text-pv-slate-700">
            <li>
              <strong className="text-pv-navy-900">Documenti verificati dall&apos;IA</strong> prima
              dell&apos;invio: niente rilavorazione, niente sorprese.
            </li>
            <li>
              <strong className="text-pv-navy-900">Pratica completa in 48 ore</strong> grazie
              alla distribuzione automatica alle agenzie partner della zona.
            </li>
            <li>
              <strong className="text-pv-navy-900">Tutto tracciato e conforme</strong>:
              GDPR, ACI, fatturazione SDI. Audit log su ogni azione.
            </li>
          </ul>
          <p className="mt-6 text-[13px] text-pv-slate-500">
            Scopri <Link href="/" className="font-bold text-pv-navy-700 hover:underline">come funziona Passaggio Veloce</Link>.
          </p>
        </div>
      </section>

      <GuideFooterCta />
      <SiteFooter />
    </main>
  );
}
