import { headers } from 'next/headers';
import Link from 'next/link';
import { Button, Card } from '@/components/ui';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { UtmCapture } from '@/components/utm-capture';
import { isLandingOnlyHost } from '@/lib/landing-gate';
import type { Metadata } from 'next';
import { JsonLd } from '@/lib/seo/JsonLdScript';
import { BRAND } from '@/lib/seo/brand';
import { buildFaqItems } from '@/lib/seo/faqItems';
import { getTariffarioCorrente } from '@/lib/tariffario';
import {
  serviceJsonLd,
  faqJsonLd,
  softwareApplicationJsonLd,
  webPageJsonLd,
} from '@/lib/seo/jsonLd';

export const metadata: Metadata = {
  title: 'Broker digitale per passaggi di proprietà auto — dealer e agenzie',
  description:
    'Passaggio Veloce connette concessionarie e agenzie pratiche auto in un\'unica piattaforma SaaS: gestione documentale IA, payout automatici, conformità ACI/GDPR/SDI. Iscrizione gratuita.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Passaggio Veloce — Broker digitale per passaggi di proprietà auto',
    description:
      'Connettiamo dealer e agenzie pratiche auto in una piattaforma unica. Gestisci pratiche, documenti e pagamenti senza carta, in conformità ACI.',
    url: '/',
  },
};

// Pre-lancio (gate host-based): sui domini gated le CTA di registrazione
// e accesso diventano un contatto email, così la vetrina raccoglie
// interesse senza esporre l'app. L'uso di headers() rende la pagina
// dynamic automaticamente (necessario perché il gate dipende dall'host
// della singola request, non dal build).
function richiediAccessoHref(contesto?: string) {
  const subject = contesto
    ? `Richiesta accesso Passaggio Veloce - ${contesto}`
    : 'Richiesta accesso Passaggio Veloce';
  return `mailto:info@passaggioveloce.it?subject=${encodeURIComponent(subject)}`;
}

export default async function HomePage() {
  const host = (await headers()).get('host');
  const landingOnly = isLandingOnlyHost(host);
  const tariffario = await getTariffarioCorrente();
  const FAQ_ITEMS = buildFaqItems(tariffario.SEMPLICE.creditoBrokerCent / 100);

  return (
    <main className="flex min-h-screen flex-col bg-white">
      <UtmCapture />
      <SiteHeader />
      <JsonLd
        data={[
          webPageJsonLd({
            url: BRAND.url,
            name: 'Passaggio Veloce — Broker digitale automotive',
            description: BRAND.description,
          }),
          serviceJsonLd(),
          faqJsonLd(FAQ_ITEMS),
          softwareApplicationJsonLd(),
        ]}
      />

      {/* Hero */}
      <section className="bg-pv-slate-50">
        <div className="mx-auto max-w-6xl px-5 pb-14 pt-12 sm:px-6 sm:pt-20 sm:pb-20">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-pv-navy-600/20 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-pv-navy-700">
              <span className="h-1.5 w-1.5 rounded-full bg-pv-orange-500" />
              Broker digitale automotive
            </span>
            <h1 className="mt-5 text-[34px] font-extrabold leading-tight tracking-tight text-pv-navy-900 sm:text-[44px]">
              Passaggi di proprietà veicoli,{' '}
              <span className="text-pv-navy-700">veloci e sicuri</span>.
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-pv-slate-700 sm:text-base">
              <strong>Passaggio Veloce</strong>{' '}è il broker digitale italiano che connette
              concessionarie auto e agenzie pratiche in un&apos;unica piattaforma: gestisci pratiche
              e documenti, in conformità ACI, GDPR e SDI.
            </p>

            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
              {landingOnly ? (
                <a href={richiediAccessoHref()}>
                  <Button size="md" className="w-full sm:w-auto">
                    Richiedi accesso anticipato
                  </Button>
                </a>
              ) : (
                <>
                  <Link href="/register">
                    <Button size="md" className="w-full sm:w-auto">
                      Registra la tua azienda
                    </Button>
                  </Link>
                  <Link href="/login">
                    <Button size="md" variant="secondary" className="w-full sm:w-auto">
                      Accedi
                    </Button>
                  </Link>
                </>
              )}
            </div>
            {landingOnly && (
              <p className="mt-4 text-[13px] text-pv-slate-500">
                Registrazioni in apertura a breve — scrivici per essere tra i primi.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-6 sm:py-16">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TrustCard
            title="Sicuro"
            text="Mandato SEPA, KYC e documenti criptati end-to-end."
            icon={<ShieldIcon />}
          />
          <TrustCard
            title="Veloce"
            text="Pratica completa in 48 ore, con notifiche in tempo reale."
            icon={<BoltIcon />}
          />
          <TrustCard
            title="Assistito"
            text="Team dedicato e supporto tecnico in ogni fase del passaggio."
            icon={<SupportIcon />}
          />
        </div>
      </section>

      {/* Come funziona */}
      <section className="bg-pv-slate-50" id="come-funziona" aria-labelledby="h-come-funziona">
        <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-[11px] font-bold uppercase tracking-wider text-pv-orange-500">
              Come funziona
            </span>
            <h2 id="h-come-funziona" className="mt-2 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[34px]">
              Dal libretto alla firma in tre passi
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-pv-slate-500 sm:text-[15px]">
              Nessuna telefonata, nessuna mail con allegati. Tutto digitale, tracciato, conforme.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
            <StepCard
              n={1}
              title="Carica i documenti"
              text="Scatta o carica libretto, CI e CF. La nostra IA legge i dati, li compila e segnala documenti incompleti prima dell'invio."
            />
            <StepCard
              n={2}
              title="Distribuiamo la pratica"
              text="Il sistema invia la richiesta alle agenzie partner più vicine al luogo di consegna, allargando il raggio finché una accetta. La prima che accetta vince."
            />
            <StepCard
              n={3}
              title="Firma e chiudi"
              text="Pratica firmata in agenzia, accredito automatico sul tuo wallet, fattura elettronica generata e trasmessa al SDI."
            />
          </div>
        </div>
      </section>

      {/* Per dealer / Per agenzia */}
      <section id="per-chi" className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-6 sm:py-20">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PersonaCard
            badge="Per dealer e concessionari"
            title="Concentra il tuo tempo sulla vendita, non sulla burocrazia"
            features={[
              'Carica una pratica in meno di 2 minuti',
              "Il dossier viene verificato dall'IA prima dell'invio",
              "Vedi in tempo reale quale agenzia l'ha presa in carico",
              'Crediti accumulati nel wallet, payout automatico oltre i 1.000€',
              'Valuta il servizio post-firma per migliorare il network',
            ]}
            ctaLabel={landingOnly ? 'Richiedi accesso' : 'Iscrivi la concessionaria'}
            ctaHref={landingOnly ? richiediAccessoHref('Concessionaria') : '/register'}
          />
          <PersonaCard
            badge="Per agenzie pratiche auto"
            title="Nuovo flusso di pratiche, già verificate, vicine alla tua sede"
            features={[
              'Ricevi solo pratiche complete: zero rilavorazione',
              'Decidi quali accettare in base ai tuoi orari di apertura',
              'Ricevi le pratiche più vicine alla tua sede, per raggio stradale reale',
              "Importi le tue tariffe una volta, l'osservatorio prezzi le aggiorna",
            ]}
            ctaLabel={landingOnly ? 'Richiedi accesso' : 'Diventa agenzia partner'}
            ctaHref={landingOnly ? richiediAccessoHref('Agenzia') : '/register'}
          />
        </div>
      </section>

      {/* Vantaggi tangibili */}
      <section className="bg-pv-slate-50" id="funzionalita" aria-labelledby="h-funzionalita">
        <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-[11px] font-bold uppercase tracking-wider text-pv-orange-500">
              Cosa ottieni
            </span>
            <h2 id="h-funzionalita" className="mt-2 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[34px]">
              Tutto quello che serve, in un unico posto
            </h2>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FeatureCard
              icon={<FileIcon />}
              title="Gestione documentale"
              text="Upload, verifica IA, archivio cifrato, scarica come ZIP."
            />
            <FeatureCard
              icon={<EuroIcon />}
              title="Wallet e payout"
              text="Crediti tracciati al centesimo, payout SEPA automatici."
            />
            <FeatureCard
              icon={<NotifyIcon />}
              title="Notifiche multi-canale"
              text="Email, SMS, in-app. Mai più una pratica dimenticata."
            />
          </div>
        </div>
      </section>

      {/* Tutele */}
      <section id="tutele" aria-labelledby="h-tutele" className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-6 sm:py-20">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_2fr] lg:gap-12">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-pv-orange-500">
              Le tue tutele
            </span>
            <h2 id="h-tutele" className="mt-2 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              Compliance e sicurezza, by design
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-pv-slate-500 sm:text-[15px]">
              Costruiamo Passaggio Veloce sotto la consulenza di commercialisti, DPO e tecnici ACI.
              Ogni transazione è tracciata, ogni dato custodito secondo gli standard più rigorosi.
            </p>
          </div>

          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TutelaItem
              title="Conforme ACI/Motorizzazione"
              text="Procedure aderenti alle ultime circolari sui passaggi di proprietà."
            />
            <TutelaItem
              title="GDPR e dati sensibili"
              text="Documenti d'identità criptati at-rest, retention configurabile."
            />
            <TutelaItem
              title="Mandato SEPA tracciato"
              text="Autorizzazione esplicita, log degli addebiti, contestabili in 8 settimane."
            />
            <TutelaItem
              title="Fatturazione SDI"
              text="Trasmissione automatica fatture elettroniche, sia broker → agenzia che agenzia → cliente."
            />
            <TutelaItem
              title="Audit completo"
              text="Ogni stato della pratica, ogni notifica, ogni movimento wallet è loggato e consultabile."
            />
            <TutelaItem
              title="Anti-frode"
              text="Verifica IA della coerenza fra libretto, CI e visura camerale prima di ogni invio."
            />
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-pv-slate-50" id="faq" aria-labelledby="h-faq">
        <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-6 sm:py-20">
          <div className="text-center">
            <span className="text-[11px] font-bold uppercase tracking-wider text-pv-orange-500">
              Domande frequenti
            </span>
            <h2 id="h-faq" className="mt-2 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              Le risposte rapide
            </h2>
          </div>

          <div className="mt-8 space-y-3">
            {FAQ_ITEMS.map((item) => (
              <FAQ key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA finale */}
      <section className="bg-pv-navy-800 text-white">
        <div className="mx-auto w-full max-w-4xl px-5 py-14 text-center sm:px-6 sm:py-20">
          <h2 className="text-[28px] font-extrabold tracking-tight sm:text-[36px]">
            Pronto a smettere di portare in giro fascicoli?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[14px] leading-relaxed text-[#b8cdea] sm:text-[16px]">
            {landingOnly
              ? 'Stiamo per aprire le registrazioni. Lascia i tuoi contatti e ti avvisiamo appena la piattaforma è online.'
              : 'Registra la tua azienda in 3 minuti. Niente carta di credito, nessun vincolo. Inizia a caricare pratiche subito.'}
          </p>
          <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
            {landingOnly ? (
              <a href={richiediAccessoHref()}>
                <Button size="md" className="w-full sm:w-auto">
                  Richiedi accesso anticipato
                </Button>
              </a>
            ) : (
              <>
                <Link href="/register">
                  <Button size="md" className="w-full sm:w-auto">
                    Registra la tua azienda
                  </Button>
                </Link>
                <Link href="/login">
                  <Button size="md" variant="secondary" className="w-full sm:w-auto">
                    Ho già un account
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

// ============================================================
// Sub-components
// ============================================================

function TrustCard({
  title,
  text,
  icon,
}: {
  title: string;
  text: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-col items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-pv-navy-100 text-pv-navy-700">
          {icon}
        </div>
        <div>
          <h3 className="text-[15px] font-bold text-pv-navy-800">{title}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-pv-slate-500">{text}</p>
        </div>
      </div>
    </Card>
  );
}

function StepCard({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <div className="rounded-[16px] border border-pv-slate-200 bg-white p-6">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-pv-navy-700 text-[14px] font-extrabold text-white">
        {n}
      </div>
      <h3 className="mt-4 text-[16px] font-bold text-pv-navy-900">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-pv-slate-500">{text}</p>
    </div>
  );
}

function PersonaCard({
  badge,
  title,
  features,
  ctaLabel,
  ctaHref,
}: {
  badge: string;
  title: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <div className="flex flex-col rounded-[16px] border border-pv-slate-200 bg-white p-7">
      <span className="text-[11px] font-bold uppercase tracking-wider text-pv-orange-500">
        {badge}
      </span>
      <h3 className="mt-2 text-[22px] font-extrabold leading-snug tracking-tight text-pv-navy-900 sm:text-[24px]">
        {title}
      </h3>
      <ul className="mt-5 flex-1 space-y-3">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-3 text-[13.5px] text-pv-slate-700">
            <CheckIcon />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-7">
        {ctaHref.startsWith('mailto:') ? (
          <a href={ctaHref}>
            <Button size="md" className="w-full sm:w-auto">
              {ctaLabel}
            </Button>
          </a>
        ) : (
          <Link href={ctaHref}>
            <Button size="md" className="w-full sm:w-auto">
              {ctaLabel}
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-pv-navy-100 text-pv-navy-700">
        {icon}
      </div>
      <h3 className="mt-4 text-[15px] font-bold text-pv-navy-900">{title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-pv-slate-500">{text}</p>
    </div>
  );
}

function TutelaItem({ title, text }: { title: string; text: string }) {
  return (
    <li className="flex items-start gap-3 rounded-[14px] border border-pv-slate-200 bg-white p-4">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pv-green-50 text-pv-green-500">
        <CheckIcon small />
      </span>
      <div>
        <h4 className="text-[14px] font-bold text-pv-navy-900">{title}</h4>
        <p className="mt-1 text-[12.5px] leading-relaxed text-pv-slate-500">{text}</p>
      </div>
    </li>
  );
}

function FAQ({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-[14px] border border-pv-slate-200 bg-white p-5 open:shadow-sm">
      <summary className="flex items-center justify-between gap-3 list-none text-[14.5px] font-semibold text-pv-navy-900">
        <span>{q}</span>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-pv-slate-200 text-pv-slate-500 transition-transform group-open:rotate-45">
          <PlusIcon />
        </span>
      </summary>
      <p className="mt-3 text-[13.5px] leading-relaxed text-pv-slate-500">{a}</p>
    </details>
  );
}

// ============================================================
// Icons
// ============================================================

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M12 3l8 3v5c0 4.5-3.2 8.6-8 10-4.8-1.4-8-5.5-8-10V6l8-3z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M9 12l2 2 4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M13 3L4 14h7l-1 7 9-11h-7l1-7z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SupportIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M4 12a8 8 0 0116 0v4a3 3 0 01-3 3h-1v-7h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 12v4a3 3 0 003 3h1v-7H4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M14 3v5h5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9 13h6M9 17h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function EuroIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M18 7a7 7 0 100 10M4 10h10M4 14h10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NotifyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M6 8a6 6 0 1112 0c0 6 3 7 3 7H3s3-1 3-7zM10 19a2 2 0 004 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon({ small = false }: { small?: boolean } = {}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={small ? 'h-3.5 w-3.5' : 'mt-0.5 h-5 w-5 shrink-0 text-pv-green-500'}
      aria-hidden="true"
    >
      <path
        d="M5 12l5 5L20 7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
