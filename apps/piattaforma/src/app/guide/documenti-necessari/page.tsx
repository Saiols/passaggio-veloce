import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Breadcrumbs } from '@/components/guide/Breadcrumbs';
import { Callout } from '@/components/guide/Callout';
import { KeyTakeaway } from '@/components/guide/KeyTakeaway';
import { GuideFooterCta } from '@/components/guide/GuideFooterCta';
import { RelatedGuides } from '@/components/guide/RelatedGuides';
import { JsonLd } from '@/lib/seo/JsonLdScript';
import { getGuide } from '@/lib/seo/guides';
import { siteUrl } from '@/lib/seo/brand';
import { articleJsonLd, faqJsonLd } from '@/lib/seo/jsonLd';

const GUIDE = getGuide('documenti-necessari')!;

const FAQS = [
  {
    q: "Posso usare la carta d'identità elettronica (CIE)?",
    a: "Sì, la CIE è equiparata a tutti gli effetti alla carta d'identità cartacea. Anche la patente di guida è accettata come documento di identità per il passaggio di proprietà, purché in corso di validità.",
  },
  {
    q: 'Cosa succede se ho perso il libretto?',
    a: "Devi richiedere un duplicato presso la Motorizzazione Civile prima di poter procedere al passaggio. Costa circa 25€ in marche da bollo + 10,20€ di diritti, e richiede 7-15 giorni lavorativi. Senza libretto valido la pratica non può essere registrata.",
  },
  {
    q: "L'auto è ancora intestata a un defunto: che documenti servono?",
    a: "Serve l'atto di accettazione di eredità (o dichiarazione sostitutiva) e il certificato di morte. Se ci sono più eredi, occorre una delega di tutti gli altri al richiedente. La pratica passa prima per l'intestazione agli eredi (esente da IPT), poi per il passaggio al nuovo acquirente.",
  },
  {
    q: "Serve il certificato di proprietà cartaceo o solo quello digitale?",
    a: "Dal novembre 2015, il certificato di proprietà cartaceo è stato sostituito dal CdPD (Certificato di Proprietà Digitale) gestito dal PRA. Se il veicolo è stato immatricolato dopo, esiste solo la versione digitale: ti basta il numero di targa per accedervi.",
  },
  {
    q: "Posso vendere un'auto se sono ancora soggetto a un fermo amministrativo?",
    a: "No. Finché il fermo amministrativo (per cartelle esattoriali, multe non pagate, ecc.) è attivo, il veicolo non può essere ceduto. Devi prima sanare la posizione e ottenere la cancellazione del fermo dall'Agenzia delle Entrate-Riscossione.",
  },
];

export const metadata: Metadata = {
  title: GUIDE.title,
  description: GUIDE.metaDescription,
  alternates: { canonical: GUIDE.url },
  openGraph: {
    title: GUIDE.title,
    description: GUIDE.metaDescription,
    url: GUIDE.url,
    type: 'article',
    publishedTime: GUIDE.lastModified,
    modifiedTime: GUIDE.lastModified,
  },
};

export default function DocumentiNecessariPage() {
  const url = siteUrl(GUIDE.url);
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <JsonLd
        data={[
          articleJsonLd({
            url,
            headline: GUIDE.title,
            description: GUIDE.metaDescription,
            datePublished: GUIDE.lastModified,
            dateModified: GUIDE.lastModified,
          }),
          faqJsonLd(FAQS),
        ]}
      />
      <Breadcrumbs
        items={[
          { name: 'Home', url: siteUrl('/') },
          { name: 'Guide', url: siteUrl('/guide') },
          { name: GUIDE.shortTitle, url },
        ]}
      />

      <article className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-12">
        <header>
          <span className="text-[11px] font-bold uppercase tracking-wider text-pv-orange-500">
            Documenti · {GUIDE.readingTimeMin} min di lettura
          </span>
          <h1 className="mt-3 text-[32px] font-extrabold leading-tight tracking-tight text-pv-navy-900 sm:text-[40px]">
            {GUIDE.title}
          </h1>
          <p className="mt-3 text-[13px] text-pv-slate-500">
            Aggiornata al {GUIDE.lastModified} · A cura di Passaggio Veloce
          </p>
        </header>

        <KeyTakeaway
          items={[
            "Venditore: carta d'identità, codice fiscale, libretto/CdP, certificato di proprietà digitale.",
            "Acquirente: carta d'identità, codice fiscale, residenza.",
            "Atto di vendita autenticato (ACI, Comune, notaio, agenzia).",
            "Termine: 60 giorni dall'atto per registrarlo, altrimenti sanzione fino a 3.629€.",
          ]}
        />

        <section className="prose-pv mt-10 space-y-4 text-[15px] leading-relaxed text-pv-slate-700">
          <h2 className="text-[24px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[28px]">
            Documenti del venditore
          </h2>
          <ul className="space-y-3 pl-5 [&>li]:list-disc">
            <li>
              <strong>Carta d&apos;identità in corso di validità</strong> (anche CIE elettronica o
              patente di guida).
            </li>
            <li>
              <strong>Codice fiscale o tessera sanitaria</strong>.
            </li>
            <li>
              <strong>Libretto di circolazione</strong> (o Documento Unico, se rilasciato dopo
              ottobre 2021, che ingloba libretto e certificato di proprietà).
            </li>
            <li>
              <strong>Certificato di Proprietà Digitale (CdPD)</strong>. Dal novembre 2015 ha
              sostituito il vecchio certificato cartaceo. Se non disponibile, basta il numero
              di targa: ACI/agenzia possono recuperarlo elettronicamente.
            </li>
            <li>
              <strong>Eventuali documenti aggiuntivi</strong> in caso di delega (se non puoi
              firmare di persona), procura notarile o atto di matrimonio in regime di comunione.
            </li>
          </ul>

          <Callout variant="warning" title="Controlla la validità prima di andare">
            Una carta d&apos;identità scaduta o una targa con annotazioni mancanti (fermo
            amministrativo, leasing non liberato) bloccano la procedura. Verifica tutto la
            settimana prima dell&apos;appuntamento.
          </Callout>

          <h2 className="mt-10 text-[24px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[28px]">
            Documenti dell&apos;acquirente
          </h2>
          <ul className="space-y-3 pl-5 [&>li]:list-disc">
            <li>
              <strong>Carta d&apos;identità in corso di validità</strong>.
            </li>
            <li>
              <strong>Codice fiscale o tessera sanitaria</strong>.
            </li>
            <li>
              <strong>Documento attestante la residenza</strong> (la carta d&apos;identità è
              sufficiente se la residenza è quella corrente; in caso contrario serve un
              certificato di residenza recente).
            </li>
            <li>
              <strong>Permesso di soggiorno</strong> (per cittadini extra-UE).
            </li>
          </ul>

          <h2 className="mt-10 text-[24px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[28px]">
            Casi speciali
          </h2>

          <h3 className="mt-6 text-[18px] font-bold text-pv-navy-900">
            Intestazione o cessione a/da società
          </h3>
          <p>
            Se il venditore o l&apos;acquirente è una società (SRL, SPA, SNC), serve:
          </p>
          <ul className="space-y-3 pl-5 [&>li]:list-disc">
            <li>
              <strong>Visura camerale aggiornata</strong> (non più vecchia di 6 mesi).
            </li>
            <li>
              <strong>Firma del legale rappresentante</strong> con autenticazione; se chi firma
              è un delegato, occorre <strong>delega notarile</strong>.
            </li>
          </ul>

          <h3 className="mt-6 text-[18px] font-bold text-pv-navy-900">
            Passaggio per eredità
          </h3>
          <p>
            Quando il proprietario è deceduto, il passaggio richiede prima un&apos;intestazione agli
            eredi (esente da IPT) e poi l&apos;eventuale cessione al nuovo acquirente. Servono:
          </p>
          <ul className="space-y-3 pl-5 [&>li]:list-disc">
            <li>
              <strong>Certificato di morte</strong>.
            </li>
            <li>
              <strong>Atto di accettazione dell&apos;eredità</strong> (o dichiarazione sostitutiva).
            </li>
            <li>
              <strong>Delega degli altri eredi</strong> al richiedente, se non sono tutti
              presenti.
            </li>
          </ul>

          <h3 className="mt-6 text-[18px] font-bold text-pv-navy-900">Veicoli in leasing</h3>
          <p>
            Se l&apos;auto è ancora in leasing, è la società di leasing l&apos;effettiva proprietaria.
            Per cederla devi:
          </p>
          <ul className="space-y-3 pl-5 [&>li]:list-disc">
            <li>
              <strong>Estinguere anticipatamente il contratto di leasing</strong> e ottenere
              la lettera liberatoria dalla società.
            </li>
            <li>
              <strong>Aggiornare il libretto</strong> con il riscatto, poi procedere al passaggio
              come per un&apos;auto normale.
            </li>
          </ul>

          <h3 className="mt-6 text-[18px] font-bold text-pv-navy-900">
            Veicoli storici o fuori uso
          </h3>
          <p>
            Per veicoli storici (ASI, FMI) o radiati dalla circolazione servono documenti
            specifici: certificato di storicità, eventuale collaudo recente, dichiarazione di
            cessione separata per veicoli destinati a demolizione.
          </p>

          <h2 className="mt-10 text-[24px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[28px]">
            La dichiarazione di vendita autenticata
          </h2>
          <p>
            Il cuore documentale del passaggio è la <strong>dichiarazione di vendita</strong>,
            firmata da entrambe le parti e con la firma del venditore autenticata. Si fa sul
            retro del Certificato di Proprietà Digitale (sezione apposita) oppure su modulo
            ACI.
          </p>
          <p>
            L&apos;autenticazione si fa presso:
          </p>
          <ul className="space-y-3 pl-5 [&>li]:list-disc">
            <li>
              <strong>Ufficio ACI</strong> — costo: 16€ di marca da bollo.
            </li>
            <li>
              <strong>Comune</strong> (URP o anagrafe) — costo: 16€ di marca da bollo.
            </li>
            <li>
              <strong>Agenzia pratiche auto STA</strong> — costo: marca da bollo + onorario.
            </li>
            <li>
              <strong>Notaio</strong> — costo: 100-200€, indicato solo per casi complessi.
            </li>
          </ul>

          <Callout variant="tip" title="Il vantaggio della STA">
            Se vai a un&apos;agenzia o ACI con autorizzazione STA, autenticazione e registrazione al
            PRA si fanno nella stessa visita: risparmi tempo e una marca da bollo.
          </Callout>

          <h2 className="mt-10 text-[24px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[28px]">
            Checklist riassuntiva
          </h2>
          <div className="mt-5 rounded-[14px] border border-pv-navy-200 bg-pv-navy-50 p-6">
            <p className="mb-4 text-[14px] font-bold text-pv-navy-900">Da portare il giorno dell&apos;appuntamento:</p>
            <ol className="space-y-2 pl-5 text-[14px] text-pv-navy-900 [&>li]:list-decimal">
              <li>Carta d&apos;identità e codice fiscale di entrambe le parti</li>
              <li>Libretto di circolazione (o Documento Unico)</li>
              <li>Certificato di Proprietà Digitale (o numero di targa)</li>
              <li>2 marche da bollo da 16€ (per atto e copia)</li>
              <li>Eventuale documento aggiuntivo per casi speciali (delega, visura, ecc.)</li>
              <li>Bancomat o carta di credito per pagare IPT + emolumenti (circa 200-300€)</li>
            </ol>
          </div>

          <h2 id="faq" className="mt-10 text-[24px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[28px]">
            Domande frequenti
          </h2>
          <div className="mt-5 space-y-3">
            {FAQS.map((faq) => (
              <details key={faq.q} className="group rounded-[14px] border border-pv-slate-200 bg-white p-5 open:shadow-sm">
                <summary className="flex items-center justify-between gap-3 list-none text-[14.5px] font-semibold text-pv-navy-900">
                  <span>{faq.q}</span>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-pv-slate-200 text-pv-slate-500 transition-transform group-open:rotate-45">
                    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                  </span>
                </summary>
                <p className="mt-3 text-[13.5px] leading-relaxed text-pv-slate-500">{faq.a}</p>
              </details>
            ))}
          </div>
        </section>
      </article>

      <GuideFooterCta />
      <RelatedGuides currentSlug={GUIDE.slug} />
      <SiteFooter />
    </main>
  );
}
