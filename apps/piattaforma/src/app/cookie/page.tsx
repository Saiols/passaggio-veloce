import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { CookiePreferencesButton } from '@/components/cookie-preferences-button';
import { JsonLd } from '@/lib/seo/JsonLdScript';
import { webPageJsonLd } from '@/lib/seo/jsonLd';
import { siteUrl } from '@/lib/seo/brand';

export const metadata: Metadata = {
  title: 'Cookie Policy',
  description:
    'Cookie policy di Passaggio Veloce: cookie tecnici, Google Analytics 4 previo consenso, finalità, durate, gestione e revoca delle preferenze.',
  alternates: { canonical: '/cookie' },
  robots: { index: true, follow: true },
};

export default function CookiePage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <JsonLd
        data={webPageJsonLd({
          url: siteUrl('/cookie'),
          name: 'Cookie Policy',
          description: 'Cookie policy di Passaggio Veloce.',
          lastModified: '2026-07-26',
        })}
      />
      <article className="mx-auto w-full max-w-3xl px-5 py-10 text-[14px] leading-relaxed text-pv-slate-700 sm:px-6">
        <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Cookie Policy
        </h1>
        <p className="mt-2 text-[12px] text-pv-slate-500">
          Ultimo aggiornamento: 2026-07-26
        </p>

        <Section title="Cosa sono i cookie">
          <p>
            I cookie sono piccoli file di testo memorizzati dal tuo browser
            quando visiti un sito web. Possono essere usati per ricordare le
            tue preferenze, mantenere la sessione di login o raccogliere
            statistiche aggregate.
          </p>
        </Section>

        <Section title="Cookie utilizzati">
          <h3 className="mt-2 text-[15px] font-bold text-pv-navy-900">
            Tecnici (sempre attivi)
          </h3>
          <ul className="list-disc pl-5">
            <li>
              <code>authjs.session-token</code>{' '}— sessione di login
              (HTTP-only, secure)
            </li>
            <li>
              <code>authjs.csrf-token</code>{' '}— protezione CSRF
            </li>
            <li>
              <code>pv-cookie-consent-v2</code>{' '}— memorizza la tua scelta sui
              cookie (LocalStorage)
            </li>
          </ul>
          <p>
            Senza questi cookie la piattaforma non può funzionare: sono
            esclusi dall&apos;obbligo di consenso preventivo (art. 122 codice
            privacy).
          </p>

          <h3 className="mt-4 text-[15px] font-bold text-pv-navy-900">
            Analytics (solo con il tuo consenso)
          </h3>
          <p>
            Usiamo <strong>Google Analytics 4</strong>{' '}per capire come viene
            usata la piattaforma (pagine viste, percorsi di navigazione,
            dispositivo) e migliorarla. Il fornitore è Google Ireland Ltd.
          </p>
          <ul className="list-disc pl-5">
            <li>
              <code>_ga</code>{' '}— identificativo del browser, durata 2 anni
            </li>
            <li>
              <code>_ga_&lt;ID&gt;</code>{' '}— stato della sessione di
              misurazione, durata 2 anni
            </li>
          </ul>
          <p>
            Sono cookie <strong>non tecnici</strong>: vengono scritti{' '}
            <strong>solo dopo il tuo consenso</strong>. Finché non lo presti,
            lo script di Google non viene nemmeno scaricato. Il trattamento può
            comportare un trasferimento di dati negli Stati Uniti, protetto
            dalle clausole contrattuali standard e dal EU-US Data Privacy
            Framework. Puoi opporti anche installando il{' '}
            <a
              href="https://tools.google.com/dlpage/gaoptout"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              componente di opt-out di Google
            </a>
            .
          </p>

          <h3 className="mt-4 text-[15px] font-bold text-pv-navy-900">
            Marketing / Tracking referral
          </h3>
          <p>
            Il programma affiliazione tracking utilizza un cookie di prima
            parte di durata 30 giorni per attribuire gli utenti che si
            registrano dopo aver cliccato un link <code>/r/&lt;code&gt;</code>.
            Il dato salvato è solo l&apos;identificativo del referente. Non
            usiamo cookie di terze parti a scopo pubblicitario.
          </p>
        </Section>

        <Section title="Come gestire i cookie">
          <p>
            Puoi cambiare o revocare le tue scelte in qualsiasi momento, con la
            stessa facilità con cui le hai date: il pulsante qui sotto riapre il
            banner. Revocando il consenso analytics disattiviamo subito Google
            Analytics ed eliminiamo i suoi cookie.
          </p>
          <div className="mt-3">
            <CookiePreferencesButton />
          </div>
          <p>
            Le impostazioni del browser restano un&apos;alternativa, così come
            la cancellazione manuale dei cookie e del LocalStorage.
          </p>
        </Section>

        <p className="mt-8 text-[11px] text-pv-slate-500">
          Vedi anche la{' '}
          <Link href="/privacy" className="font-semibold text-pv-navy-700 hover:underline">
            Privacy Policy
          </Link>{' '}
          completa.
        </p>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[18px] font-bold text-pv-navy-900">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}
