import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';

export const metadata = {
  title: 'Privacy Policy — Passaggio Veloce',
};

/**
 * Boilerplate Privacy Policy ITA. Da rivedere con il legale prima del
 * lancio in prod (B10 / B11): aggiungere DPO, base giuridica specifiche,
 * ricorso al Garante, periodo di conservazione preciso per categoria.
 */
export default function PrivacyPage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <article className="mx-auto w-full max-w-3xl px-5 py-10 text-[14px] leading-relaxed text-pv-slate-700 sm:px-6">
        <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Privacy Policy
        </h1>
        <p className="mt-2 text-[12px] text-pv-slate-500">
          Ultimo aggiornamento: 2026-05-06
        </p>

        <Section title="Titolare del trattamento">
          <p>
            Passaggio Veloce S.r.l., con sede legale in Italia, è il titolare
            del trattamento dei dati personali raccolti tramite la piattaforma
            <code> passaggioveloce.it</code> e i sottodomini collegati.
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
              pratiche (libretto, CI/CF, visure, ecc.), dati estratti via
              OCR, comunicazioni con le agenzie.
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
          </ul>
        </Section>

        <Section title="Conservazione">
          <p>
            I dati delle pratiche sono conservati per la durata del rapporto
            contrattuale e per il periodo previsto dalla normativa fiscale
            (10 anni). I dati di account eliminato sono soft-deleted per 90
            giorni e poi rimossi dai backup attivi (compliance GDPR).
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

        <Section title="Trasferimenti internazionali">
          <p>
            La maggior parte dei trattamenti avviene su server in UE (Vercel,
            Neon — region eu-central). Alcuni servizi (es. Sentry per error
            monitoring) potrebbero comportare trasferimenti extra-UE protetti
            da clausole contrattuali standard.
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
          Documento boilerplate, in attesa di revisione legale (B10/B11). Per
          la versione definitiva contatta{' '}
          <Link href="/cookie" className="font-semibold text-pv-navy-700 hover:underline">
            la cookie policy
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
