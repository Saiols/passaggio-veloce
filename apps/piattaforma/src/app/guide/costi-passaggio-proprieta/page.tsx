import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Breadcrumbs } from '@/components/guide/Breadcrumbs';
import { Callout } from '@/components/guide/Callout';
import { CostsTable } from '@/components/guide/CostsTable';
import { KeyTakeaway } from '@/components/guide/KeyTakeaway';
import { GuideFooterCta } from '@/components/guide/GuideFooterCta';
import { RelatedGuides } from '@/components/guide/RelatedGuides';
import { JsonLd } from '@/lib/seo/JsonLdScript';
import { getGuide } from '@/lib/seo/guides';
import { siteUrl } from '@/lib/seo/brand';
import { articleJsonLd, faqJsonLd } from '@/lib/seo/jsonLd';

const GUIDE = getGuide('costi-passaggio-proprieta')!;

const COSTI_ROWS = [
  { voce: 'IPT (Imposta Provinciale di Trascrizione)', importo: '150,81€ – 250€', note: 'Variabile per provincia e kW' },
  { voce: 'Emolumenti ACI', importo: '27,00€', note: 'Fisso a livello nazionale' },
  { voce: 'Imposta di bollo per passaggio', importo: '32,00€', note: 'Forfettaria' },
  { voce: 'Marche da bollo (×2)', importo: '32,00€', note: "Atto + copia registrata" },
  { voce: 'Diritti Motorizzazione', importo: '10,20€', note: 'Aggiornamento CdPD' },
  { voce: 'Onorario agenzia (opzionale)', importo: '50,00€ – 100,00€', note: "Solo se ti rivolgi a un'agenzia" },
];

const IPT_PROVINCE = [
  { provincia: 'Roma',     baseAuto: '150,81€', maggiorazione: '+30%', stimaAuto70kW: '~280€' },
  { provincia: 'Milano',   baseAuto: '150,81€', maggiorazione: '+20%', stimaAuto70kW: '~258€' },
  { provincia: 'Napoli',   baseAuto: '150,81€', maggiorazione: '+30%', stimaAuto70kW: '~280€' },
  { provincia: 'Torino',   baseAuto: '150,81€', maggiorazione: '+30%', stimaAuto70kW: '~280€' },
  { provincia: 'Bologna',  baseAuto: '150,81€', maggiorazione: '+20%', stimaAuto70kW: '~258€' },
  { provincia: 'Firenze',  baseAuto: '150,81€', maggiorazione: '+20%', stimaAuto70kW: '~258€' },
  { provincia: 'Genova',   baseAuto: '150,81€', maggiorazione: '+30%', stimaAuto70kW: '~280€' },
  { provincia: 'Palermo',  baseAuto: '150,81€', maggiorazione: '+10%', stimaAuto70kW: '~237€' },
  { provincia: 'Bari',     baseAuto: '150,81€', maggiorazione: '+20%', stimaAuto70kW: '~258€' },
  { provincia: 'Verona',   baseAuto: '150,81€', maggiorazione: '+20%', stimaAuto70kW: '~258€' },
];

const FAQS = [
  {
    q: "Quanto costa in totale il passaggio di proprietà nel 2026?",
    a: "Per un'auto: tra ~250€ (cilindrata bassa in provincia senza maggiorazione) e ~350€ (alta cilindrata, maggiorazione massima), escluso l'onorario di agenzia. Per una moto piccola si parte da ~50€. Il valore esatto dipende soprattutto dall'IPT, che varia per provincia e potenza.",
  },
  {
    q: "L'IPT è uguale in tutta Italia?",
    a: "No. La base è di 150,81€ per autoveicoli fino a 53 kW, ma ogni provincia può applicare una maggiorazione fino al 30%. Oltre i 53 kW si aggiungono circa 3,51€ per ogni kW eccedente.",
  },
  {
    q: 'Posso risparmiare sui costi?',
    a: "Sì, in tre modi principali: (1) fare il passaggio direttamente all'ACI o online evita l'onorario di agenzia (50-100€); (2) scegliere bene la provincia di residenza se hai più opzioni; (3) per veicoli ecologici (full electric, ibride plug-in) alcune regioni offrono esenzioni o riduzioni IPT.",
  },
  {
    q: 'Le moto pagano meno?',
    a: "Sì, le moto hanno IPT ridotta. Per le moto fino a 11 kW (15 CV) si pagano 19,06€ base + maggiorazione provinciale, molto meno dell'auto. Gli altri costi (emolumenti, bolli, motorizzazione) sono simili.",
  },
  {
    q: "Si possono pagare i costi a rate?",
    a: "No, il pagamento è in un'unica soluzione al momento della registrazione PRA. Puoi però usare carta di credito o bancomat presso ACI, agenzie e online.",
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

export default function CostiPassaggioPage() {
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
            Costi · {GUIDE.readingTimeMin} min di lettura
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
            "Range totale 2026: ~50€ (moto piccola) – ~280€ (auto ad alta cilindrata in provincia con maggiorazione massima).",
            "Voce più variabile: IPT, che dipende dalla provincia di residenza dell'acquirente e dai kW del veicolo.",
            "Sempre fissi: marche da bollo (32€), emolumenti ACI (27€), diritti motorizzazione (10,20€).",
            "Onorario agenzia (50-100€): evitabile fai-da-te all'ACI o online.",
          ]}
        />

        <section className="prose-pv mt-10 space-y-4 text-[15px] leading-relaxed text-pv-slate-700">
          <h2 className="text-[24px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[28px]">
            Quanto costa il passaggio di proprietà nel 2026
          </h2>
          <p>
            Il costo complessivo del passaggio di proprietà di un&apos;auto nel 2026 si compone di
            quattro voci di legge (sempre dovute), una variabile principale (l&apos;IPT) e un&apos;eventuale
            voce di servizio (l&apos;onorario dell&apos;agenzia, se non fai da te).
          </p>
          <p>
            Ecco la tabella completa con i valori standard. I numeri sono aggiornati al{' '}
            {GUIDE.lastModified} sulla base delle tariffe ufficiali ACI e dei riferimenti
            normativi vigenti.
          </p>

          <CostsTable
            rows={COSTI_ROWS}
            total="≈ 250€ – 350€"
            caption="Tabella riepilogativa dei costi per un'auto standard (residente in provincia con maggiorazione IPT del 20%)"
          />

          <Callout variant="info" title="Esempio concreto">
            Auto usata 70 kW intestata a residente in <strong>Milano</strong>: 150,81€ (IPT base) +
            ~59,67€ (17 kW oltre 53 × 3,51€) = 210,48€ × 1,20 (maggiorazione 20%) ={' '}
            <strong>~253€ di IPT</strong>. Aggiungi 27€ + 32€ + 32€ + 10,20€ ={' '}
            <strong>≈ 354€ totali</strong> di tasse di legge. Con agenzia: ~434€.
          </Callout>

          <h2 className="mt-10 text-[24px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[28px]">
            IPT nelle top 10 città italiane
          </h2>
          <p>
            L&apos;IPT è la voce che fa la differenza. Base nazionale 150,81€ per veicoli fino a 53 kW,
            con maggiorazione provinciale dal +0% al +30% e supplemento per ogni kW eccedente.
            Ecco le stime per un&apos;auto a 70 kW nelle 10 principali città:
          </p>

          <CostsTable
            rows={IPT_PROVINCE.map((p) => ({
              voce: p.provincia,
              importo: p.stimaAuto70kW,
              note: `Base ${p.baseAuto} · Magg. ${p.maggiorazione}`,
            }))}
            caption="Stima IPT per auto usata a 70 kW (le maggiorazioni provinciali possono variare di anno in anno)"
          />

          <Callout variant="warning" title="Verifica sempre la tariffa aggiornata">
            Le maggiorazioni provinciali possono cambiare con delibere comunali e regionali.
            Prima di registrare il passaggio, conferma la tariffa vigente sul sito ufficiale ACI
            (www.aci.it) o presso l&apos;ufficio PRA di competenza.
          </Callout>

          <h2 className="mt-10 text-[24px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[28px]">
            Cosa influenza il costo
          </h2>
          <ul className="space-y-3 pl-5 [&>li]:list-disc">
            <li>
              <strong>Potenza del veicolo (kW).</strong> Per auto oltre 53 kW si aggiungono ~3,51€
              per ogni kW eccedente. Un SUV da 110 kW paga ~200€ di soli kW supplementari, prima
              della maggiorazione.
            </li>
            <li>
              <strong>Provincia di residenza dell&apos;acquirente.</strong> La maggiorazione varia dal
              0% al 30%. Bolzano è tra le più basse, le grandi città del Centro-Sud spesso al 30%.
            </li>
            <li>
              <strong>Tipo di veicolo.</strong> Moto, autocarri leggeri, veicoli storici hanno
              regimi diversi con tariffe spesso più favorevoli.
            </li>
            <li>
              <strong>Alimentazione ecologica.</strong> Veicoli elettrici e ibridi plug-in
              godono di esenzioni o riduzioni IPT in molte regioni italiane (Piemonte, Lombardia,
              Lazio offrono sconti significativi).
            </li>
            <li>
              <strong>Tipo di intermediario.</strong> Le agenzie aggiungono onorario; l&apos;ACI
              applica tariffe più contenute; il fai-da-te online è la via meno costosa.
            </li>
          </ul>

          <h2 className="mt-10 text-[24px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[28px]">
            Come risparmiare
          </h2>
          <ul className="space-y-3 pl-5 [&>li]:list-disc">
            <li>
              <strong>Fai-da-te all&apos;ACI o online.</strong> Risparmi 50-100€ di onorario agenzia.
              Funziona se sei a tuo agio con SPID e hai documenti già in ordine.
            </li>
            <li>
              <strong>Sfrutta gli incentivi regionali per ecologico.</strong> Se acquisti
              un&apos;auto elettrica o ibrida plug-in, controlla l&apos;esenzione IPT nella tua regione.
            </li>
            <li>
              <strong>Evita ritardi.</strong> Oltre i 60 giorni scatta una sanzione amministrativa
              da 727€ a 3.629€: il primo modo di risparmiare è non sbagliare i tempi.
            </li>
            <li>
              <strong>Confronta agenzie.</strong> Se preferisci delegare, gli onorari variano
              molto: chiedi sempre il preventivo prima.
            </li>
          </ul>

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
