import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { JsonLd } from '@/lib/seo/JsonLdScript';
import { webPageJsonLd } from '@/lib/seo/jsonLd';
import { siteUrl } from '@/lib/seo/brand';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Informativa privacy di Passaggio Veloce: titolare, dati raccolti, finalità, base giuridica, conservazione, diritti dell\'interessato.',
  alternates: { canonical: '/privacy' },
  robots: { index: true, follow: true },
};

/**
 * Privacy Policy per gli UTENTI REGISTRATI (broker e agenzie). I dati di
 * venditori e acquirenti — soggetti terzi che non hanno un rapporto con noi —
 * hanno un'informativa dedicata ex art. 14: `app/privacy/clienti/page.tsx`.
 *
 * Da rivedere con il legale prima del lancio in prod: aggiungere DPO e
 * ricorso al Garante per categoria.
 * Spec: docs/superpowers/specs/2026-07-14-gdpr-dati-terzi-design.md
 */
export default function PrivacyPage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <JsonLd
        data={webPageJsonLd({
          url: siteUrl('/privacy'),
          name: 'Privacy Policy',
          description: 'Informativa privacy di Passaggio Veloce.',
          lastModified: '2026-07-14',
        })}
      />
      <article className="mx-auto w-full max-w-3xl px-5 py-10 text-[14px] leading-relaxed text-pv-slate-700 sm:px-6">
        <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Privacy Policy
        </h1>
        <p className="mt-2 text-[12px] text-pv-slate-500">
          Ultimo aggiornamento: 2026-07-14
        </p>

        <Section title="Titolare del trattamento">
          <p>
            Passaggio Veloce S.r.l., con sede legale in Italia, è il titolare
            del trattamento dei dati personali raccolti tramite la piattaforma
            <code> passaggioveloce.it</code>{' '}e i sottodomini collegati.
          </p>
          <p>
            Per qualsiasi richiesta in materia di protezione dati:{' '}
            <a
              href="mailto:privacy@passaggioveloce.it"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              privacy@passaggioveloce.it
            </a>
          </p>
        </Section>

        <Section title="Tipologie di dati trattati">
          <ul className="list-disc pl-5">
            <li>
              <strong>Dati di registrazione e profilo</strong>: nome, cognome,
              codice fiscale, dati anagrafici dell&apos;amministratore di
              azienda, ragione sociale, P.IVA, PEC, IBAN, codice SDI.
            </li>
            <li>
              <strong>Dati operativi</strong>: documenti caricati per le
              pratiche (libretto di circolazione, carta d&apos;identità,
              patente, passaporto, codice fiscale, visure), dati estratti via
              OCR, comunicazioni con le agenzie.
            </li>
            <li>
              <strong>Dati di venditori e acquirenti</strong>{' '}
              (soggetti terzi rispetto all&apos;utente registrato), conferiti
              dall&apos;utente
              per la lavorazione della pratica. Quando la pratica lo richiede
              includono <strong>permesso di soggiorno</strong>,{' '}
              <strong>certificato di morte</strong>{' '}e atti di successione,
              procure e autorizzazioni del giudice tutelare. Rispetto a questi
              dati Passaggio Veloce è titolare autonomo: v.{' '}
              <Link
                href="/privacy/clienti"
                className="font-semibold text-pv-navy-700 hover:underline"
              >
                informativa per venditori e acquirenti
              </Link>
              .
            </li>
            <li>
              <strong>Dati finanziari</strong>: addebiti, payout, transazioni
              wallet (importi e timestamp; i dati di pagamento Stripe sono
              trattati direttamente dal processor).
            </li>
            <li>
              <strong>Dati tecnici</strong>: indirizzo IP (anonimizzato a 3
              ottetti), user-agent, log di accesso. Nessun cookie di
              tracciamento di terze parti attivo al momento.
            </li>
          </ul>
        </Section>

        <Section title="Finalità e basi giuridiche">
          <ul className="list-disc pl-5">
            <li>
              Esecuzione del contratto e gestione delle pratiche di passaggio
              di proprietà (art. 6.1.b GDPR).
            </li>
            <li>
              Adempimenti fiscali e contabili (art. 6.1.c GDPR).
            </li>
            <li>
              Sicurezza della piattaforma, anti-abuso e investigazione di
              eventuali frodi (legittimo interesse, art. 6.1.f GDPR).
            </li>
            <li>
              Comunicazioni di servizio sul ciclo di vita della pratica
              (esecuzione del contratto).
            </li>
            <li>
              Sviluppo e miglioramento del servizio, e finalità commerciali, tramite un elenco
              aggregato dei contatti (nome, contatti, identificativo fiscale, numero di
              pratiche) emersi dalle pratiche gestite (legittimo interesse, art. 6.1.f GDPR).
            </li>
          </ul>
        </Section>

        <Section title="Conservazione">
          <p>
            I documenti rimossi vengono cancellati definitivamente (dal
            database e dallo storage) <strong>90 giorni</strong>{' '}dopo la
            rimozione. Le pratiche rimaste in <strong>bozza</strong>{' '}e mai
            inviate, con i relativi documenti, vengono eliminate dopo{' '}
            <strong>30 giorni</strong>.
          </p>
          <p>
            I dati delle pratiche <strong>portate a termine</strong>{' '}e i dati
            contabili e fiscali sono conservati per il periodo imposto dalla
            normativa fiscale e dagli obblighi connessi agli adempimenti sul
            veicolo. I dati di un account eliminato sono soft-deleted per{' '}
            <strong>90 giorni</strong>{' '}e poi rimossi, fatti salvi gli obblighi
            di conservazione di legge.
          </p>
        </Section>

        <Section title="Diritti dell'interessato">
          <p>
            Hai diritto di chiedere accesso, rettifica, cancellazione,
            limitazione, opposizione e portabilità dei tuoi dati personali.
            Hai inoltre diritto di proporre reclamo al Garante per la
            Protezione dei Dati Personali (
            <a
              href="https://www.garanteprivacy.it"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              garanteprivacy.it
            </a>
            ).
          </p>
        </Section>

        <Section title="Fornitori terzi e responsabili del trattamento">
          <p>
            Per erogare il servizio ci avvaliamo di fornitori terzi che
            trattano dati per nostro conto, con sede o trattamento
            nell&apos;Unione Europea:
          </p>
          <ul className="list-disc pl-5">
            <li>
              <strong>Google Cloud – Document AI</strong>: lettura automatica
              (OCR) dei documenti caricati in fase di registrazione (carta
              d&apos;identità, tessera sanitaria/codice fiscale, visura
              camerale) per la verifica dell&apos;identità e dei requisiti
              (KYC). Regione di trattamento: Unione Europea.
            </li>
            <li>
              <strong>Google Maps Platform</strong>: completamento e
              validazione dell&apos;indirizzo aziendale in fase di
              registrazione.
            </li>
            <li>
              <strong>Resend</strong>: invio delle email transazionali
              (conferme, notifiche, reset password). Trattamento
              nell&apos;Unione Europea.
            </li>
            <li>
              <strong>Vercel</strong>: hosting e distribuzione
              dell&apos;applicazione.
            </li>
            <li>
              <strong>Neon</strong>: database gestito (PostgreSQL), regione
              Unione Europea.
            </li>
            <li>
              <strong>Vercel Blob</strong>: archiviazione dei documenti
              caricati (libretti, documenti di identità, visure).
            </li>
          </ul>
        </Section>

        <Section title="Trasferimenti internazionali">
          <p>
            La maggior parte dei trattamenti avviene su server in UE (si
            veda la sezione &ldquo;Fornitori terzi&rdquo; per i dettagli per
            singolo fornitore). Alcuni servizi ausiliari (es. Sentry per
            error monitoring) potrebbero comportare trasferimenti extra-UE
            protetti da clausole contrattuali standard.
          </p>
        </Section>

        <Section title="Modifiche alla policy">
          <p>
            Ci riserviamo di aggiornare questa policy in caso di evoluzione
            normativa o di funzionalità. La data di ultimo aggiornamento è
            indicata in cima al documento. In caso di modifiche sostanziali
            comunicheremo via email agli utenti registrati.
          </p>
        </Section>

        <p className="mt-8 text-[11px] text-pv-slate-500">
          Documento in versione tecnica, soggetto a revisione legale prima
          dell&apos;entrata in vigore definitiva. Se sei un venditore o un
          acquirente e i tuoi dati ci sono stati trasmessi da un
          professionista, l&apos;informativa che ti riguarda è{' '}
          <Link
            href="/privacy/clienti"
            className="font-semibold text-pv-navy-700 hover:underline"
          >
            questa
          </Link>
          . Vedi anche la{' '}
          <Link href="/cookie" className="font-semibold text-pv-navy-700 hover:underline">
            cookie policy
          </Link>{' '}
          e i{' '}
          <Link href="/termini" className="font-semibold text-pv-navy-700 hover:underline">
            termini di servizio
          </Link>
          .
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
