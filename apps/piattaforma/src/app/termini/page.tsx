import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { JsonLd } from '@/lib/seo/JsonLdScript';
import { webPageJsonLd } from '@/lib/seo/jsonLd';
import { siteUrl } from '@/lib/seo/brand';

export const metadata: Metadata = {
  title: 'Termini e Condizioni',
  description: 'Termini e condizioni di utilizzo della piattaforma Passaggio Veloce: registrazione, account, responsabilità, foro competente.',
  alternates: { canonical: '/termini' },
  robots: { index: true, follow: true },
};

/**
 * Boilerplate Termini di Servizio. Da rivedere col legale prima del lancio
 * (clausole su responsabilità, limiti, fee, recesso, foro competente).
 */
export default function TerminiPage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <JsonLd
        data={webPageJsonLd({
          url: siteUrl('/termini'),
          name: 'Termini e Condizioni',
          description: 'Termini e condizioni di utilizzo di Passaggio Veloce.',
        })}
      />
      <article className="mx-auto w-full max-w-3xl px-5 py-10 text-[14px] leading-relaxed text-pv-slate-700 sm:px-6">
        <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Termini di Servizio
        </h1>
        <p className="mt-2 text-[12px] text-pv-slate-500">
          Ultimo aggiornamento: 2026-05-06
        </p>

        <Section title="1. Oggetto del servizio">
          <p>
            Passaggio Veloce è una piattaforma B2B che mette in contatto
            broker (dealer/concessionarie auto) con agenzie pratiche
            automobilistiche per la gestione di passaggi di proprietà,
            minivolture e servizi correlati.
          </p>
          <p>
            Passaggio Veloce non è parte delle pratiche auto: il rapporto
            contrattuale di esecuzione resta tra il broker e l&apos;agenzia
            assegnata. La piattaforma fornisce gli strumenti tecnologici di
            distribuzione, tracking, fatturazione e supporto.
          </p>
        </Section>

        <Section title="2. Account e responsabilità">
          <p>
            L&apos;utente è responsabile della veridicità dei dati forniti in
            fase di registrazione e dell&apos;accuratezza dei documenti
            caricati per le pratiche. La sospensione dell&apos;account può
            avvenire in caso di frode, abuso del programma di affiliazione,
            mancata accettazione reiterata delle pratiche assegnate (vedi
            anti-abuso).
          </p>
        </Section>

        <Section title="3. Fee e fatturazione">
          <p>
            Le fee per pratica sono indicate al momento dell&apos;invio. Per
            le agenzie l&apos;addebito avviene al momento della firma con
            scheduling automatico a 20 giorni dal lavoro. Per i broker la
            quota è accreditata sul wallet alla firma.
          </p>
          <p>
            Tutte le transazioni sono fatturate elettronicamente via SDI
            secondo la normativa italiana sulla fatturazione B2B.
          </p>
        </Section>

        <Section title="4. Programma di affiliazione">
          <p>
            Il programma di affiliazione consente di guadagnare commissioni
            su ogni pratica completata da utenti registrati col tuo link
            referral. Le commissioni sono accreditate sul wallet e soggette
            al controllo anti-collusione. Il dettaglio è descritto nella{' '}
            <Link href="/affiliazione" className="font-semibold text-pv-navy-700 hover:underline">
              pagina Affiliazione
            </Link>{' '}
            (visibile dopo il login).
          </p>
        </Section>

        <Section title="5. Sospensione e cancellazione">
          <p>
            Passaggio Veloce può sospendere o cancellare un account in caso
            di violazione dei presenti termini, anti-abuso, mancato pagamento
            di fee o richiesta di provvedimenti dell&apos;Autorità.
            L&apos;utente può richiedere in qualsiasi momento la cessazione
            del servizio scrivendo a{' '}
            <a
              href="mailto:assistenza@passaggioveloce.it"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              assistenza@passaggioveloce.it
            </a>
            .
          </p>
        </Section>

        <Section title="6. Limitazioni di responsabilità">
          <p>
            Passaggio Veloce non è responsabile di errori o omissioni nei
            documenti caricati dall&apos;utente, né di ritardi
            nell&apos;esecuzione delle pratiche da parte delle agenzie.
            La nostra responsabilità è limitata al corretto funzionamento
            tecnologico della piattaforma e all&apos;esecuzione delle
            transazioni economiche tracciate.
          </p>
        </Section>

        <Section title="7. Modifiche">
          <p>
            I presenti termini possono essere modificati con preavviso di 30
            giorni notificato via email. Per modifiche sostanziali (fee,
            ambito del servizio) sarà richiesta la riaccettazione esplicita.
          </p>
        </Section>

        <Section title="8. Foro competente e legge applicabile">
          <p>
            I presenti termini sono regolati dalla legge italiana. Per
            qualsiasi controversia il foro competente è quello del luogo di
            sede legale di Passaggio Veloce S.r.l.
          </p>
        </Section>

        <p className="mt-8 text-[11px] text-pv-slate-500">
          Documento boilerplate, in attesa di revisione legale (B10/B11). La
          versione definitiva sarà comunicata via email agli utenti
          registrati prima dell&apos;entrata in vigore.
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
