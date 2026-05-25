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
import { howToJsonLd, faqJsonLd } from '@/lib/seo/jsonLd';

const GUIDE = getGuide('come-fare-passaggio-di-proprieta')!;

const STEPS = [
  {
    title: 'Accordo tra le parti e dichiarazione di vendita',
    body: "Venditore e acquirente concordano il prezzo e firmano la dichiarazione di vendita sul retro del Certificato di Proprietà Digitale (CdPD) o sul foglio complementare. La firma del venditore deve poi essere autenticata.",
  },
  {
    title: 'Raccolta dei documenti necessari',
    body: "Servono carta d'identità in corso di validità e codice fiscale di entrambe le parti, il libretto di circolazione (o Documento Unico se rilasciato dopo ottobre 2021) e il certificato di proprietà digitale del veicolo.",
  },
  {
    title: 'Autenticazione della firma del venditore',
    body: "L'autenticazione si può fare presso un ufficio ACI, il Comune (URP o ufficio anagrafe), un notaio o un'agenzia di pratiche auto convenzionata. Costa una marca da bollo da 16€.",
  },
  {
    title: 'Registrazione al PRA e pagamento delle imposte',
    body: "Entro 60 giorni dall'atto, l'acquirente deve registrare il passaggio al Pubblico Registro Automobilistico. Si pagano IPT (variabile per provincia e potenza del veicolo), emolumenti ACI (27€ circa) e diritti motorizzazione (10,20€).",
  },
  {
    title: 'Aggiornamento alla Motorizzazione Civile',
    body: "Dal 5 ottobre 2015, con il sistema STA (Sportello Telematico dell'Automobilista), l'aggiornamento alla Motorizzazione è automatico e contestuale alla registrazione PRA: ricevi il nuovo Certificato di Proprietà Digitale già aggiornato.",
  },
];

const FAQS = [
  {
    q: 'Posso fare il passaggio di proprietà online?',
    a: "Sì, dal 2020 alcune procedure sono disponibili online tramite il portale dell'Automobilista (www.ilportaledellautomobilista.it) usando SPID o CIE. Tuttavia l'autenticazione della firma richiede ancora la presenza fisica presso ACI, Comune, notaio o agenzia.",
  },
  {
    q: "Cosa succede se non registro il passaggio entro 60 giorni?",
    a: 'Scatta una sanzione amministrativa da 727€ a 3.629€ (artt. 247-bis e 247-ter del Codice della Strada). Inoltre, fino alla registrazione, il vecchio proprietario resta responsabile civilmente per multe e violazioni del nuovo conducente.',
  },
  {
    q: "Se compro un'auto da una società, cosa cambia?",
    a: "Serve una visura camerale aggiornata della società venditrice (non oltre 6 mesi) e la firma del legale rappresentante con autenticazione. Se chi firma è un delegato, occorre la delega notarile. I documenti dell'acquirente restano gli stessi.",
  },
  {
    q: 'Posso fare tutto in una sola visita?',
    a: "Sì, andando direttamente a un'agenzia pratiche auto convenzionata STA si possono autenticare la firma e registrare il passaggio nella stessa giornata. L'ACI offre un servizio simile. Notaio e Comune fanno solo l'autenticazione: per la registrazione devi poi andare separatamente al PRA.",
  },
  {
    q: 'Quanto costa in totale?',
    a: "Per un'auto: tra ~250€ (cilindrata bassa, provincia senza maggiorazione) e ~350€ (alta cilindrata, maggiorazione massima). Per una moto piccola si parte da ~50€. La guida ai costi dettaglia ogni voce.",
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

export default function ComeFarePassaggioPage() {
  const url = siteUrl(GUIDE.url);
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <JsonLd
        data={[
          howToJsonLd({
            url,
            name: GUIDE.title,
            description: GUIDE.metaDescription,
            totalTime: 'PT2D',
            estimatedCostEUR: '50-350',
            supplies: [
              "Carta d'identità in corso di validità",
              'Codice fiscale',
              'Libretto di circolazione o Documento Unico',
              'Certificato di Proprietà Digitale',
            ],
            tools: ['SPID o CIE (per pratiche online)', 'Marche da bollo da 16€'],
            steps: STEPS,
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
            Procedura · {GUIDE.readingTimeMin} min di lettura
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
            'Tempo medio: 1-2 giorni lavorativi se i documenti sono in ordine.',
            'Costo totale: ~250-350€ per auto (da ~50€ per moto piccola), a seconda di provincia e potenza.',
            'Dove farlo: ACI, agenzia pratiche, notaio, oppure online via SPID (con qualche limite).',
            "Documenti chiave: carta d'identità, codice fiscale e libretto/CdP di entrambe le parti.",
            "Termine inderogabile: 60 giorni dall'atto, altrimenti scatta sanzione fino a 3.629€.",
          ]}
        />

        <section className="prose-pv mt-10 space-y-4 text-[15px] leading-relaxed text-pv-slate-700">
          <h2 className="text-[24px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[28px]">
            Cos&apos;è il passaggio di proprietà
          </h2>
          <p>
            Il passaggio di proprietà è la procedura legale con cui si trasferisce la titolarità
            di un veicolo da un soggetto a un altro. È disciplinato dall&apos;art. 94 del Codice
            della Strada (D.Lgs. 285/1992) e regolato dal DPR 358/2000. Dal novembre 2015,
            il Certificato di Proprietà cartaceo è stato sostituito dal Certificato di
            Proprietà Digitale (CdPD), interamente gestito dal PRA.
          </p>
          <p>
            Il passaggio si compone di due atti distinti: la <strong>vendita</strong> (privatistica,
            tra le parti) e la <strong>registrazione pubblica</strong> (al PRA). Solo dopo la
            registrazione il nuovo proprietario è ufficialmente intestatario del veicolo
            agli occhi dello Stato.
          </p>

          <h2 className="mt-10 text-[24px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[28px]">
            I 5 step per il passaggio di proprietà
          </h2>

          {STEPS.map((step, i) => (
            <div key={i} id={`step-${i + 1}`} className="mt-6 rounded-[14px] border border-pv-slate-200 bg-pv-slate-50 p-6">
              <div className="flex items-baseline gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pv-navy-700 text-[14px] font-extrabold text-white">
                  {i + 1}
                </span>
                <h3 className="text-[18px] font-bold text-pv-navy-900">{step.title}</h3>
              </div>
              <p className="mt-3 pl-11 text-[14.5px] leading-relaxed text-pv-slate-700">
                {step.body}
              </p>
            </div>
          ))}

          <Callout variant="warning" title="Attenzione: 60 giorni inderogabili">
            Il termine di 60 giorni decorre dalla data dell&apos;atto di vendita (autenticazione della
            firma), non dalla consegna del veicolo. Oltre, scatta una sanzione amministrativa
            consistente a carico dell&apos;acquirente.
          </Callout>

          <h2 className="mt-10 text-[24px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[28px]">
            Dove andare: ACI, agenzia, notaio, online
          </h2>
          <p>
            Hai quattro opzioni principali. Ciascuna ha pro e contro in termini di tempi, costi
            e comodità:
          </p>

          <ul className="space-y-3 pl-5 [&>li]:list-disc">
            <li>
              <strong>Agenzia di pratiche auto (consigliata).</strong> Le agenzie convenzionate STA
              sono autorizzate sia ad autenticare la firma sia a registrare il passaggio al PRA
              nella stessa visita. Tempo medio: 30-60 minuti. Costo onorario: 50-100€ oltre alle
              tasse di legge. È l&apos;opzione più rapida e meno frammentata.
            </li>
            <li>
              <strong>Uffici ACI.</strong> Stessa autorizzazione delle agenzie (STA). Tariffe
              spesso più contenute. Richiede appuntamento. Tempi simili all&apos;agenzia.
            </li>
            <li>
              <strong>Comune (URP o anagrafe).</strong> Autentica solo la firma, costo bassissimo
              (16€ di marca da bollo). Poi devi andare separatamente al PRA per la registrazione.
              Più passaggi ma risparmi sull&apos;onorario.
            </li>
            <li>
              <strong>Notaio.</strong> Solo per casi complessi (società, eredità, comproprietà):
              autenticazione robusta ma più costosa (100-200€).
            </li>
            <li>
              <strong>Online (Portale dell&apos;Automobilista).</strong> Disponibile per alcuni casi
              standard, richiede SPID o CIE. Resta comunque necessaria la firma autenticata di
              persona. Pratico per chi è esperto e ha documenti già in ordine.
            </li>
          </ul>

          <Callout variant="tip" title="Suggerimento pratico">
            Se sei un dealer o un&apos;agenzia che gestisce passaggi a volume, un broker digitale come
            Passaggio Veloce automatizza la verifica documenti via IA prima dell&apos;invio,
            riducendo le rilavorazioni e i tempi morti.
          </Callout>

          <h2 className="mt-10 text-[24px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[28px]">
            Tempi realistici
          </h2>
          <p>
            Nel caso più semplice (auto usata standard, documenti in ordine, agenzia STA) il
            passaggio si chiude in <strong>1-2 giorni lavorativi</strong>. Se devi raccogliere
            documenti mancanti o procurarti il duplicato del libretto, calcola 5-10 giorni in
            più. Per i casi complessi (eredità, leasing, società) si arriva facilmente a 2-3
            settimane, soprattutto se serve l&apos;intervento del notaio.
          </p>

          <h2 className="mt-10 text-[24px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[28px]">
            Errori comuni (e come evitarli)
          </h2>
          <ul className="space-y-3 pl-5 [&>li]:list-disc">
            <li>
              <strong>Firma non autenticata.</strong> Una vendita su pezzo di carta senza
              autenticazione non ha valore per il PRA. Sempre autenticare presso ACI, Comune,
              notaio o agenzia.
            </li>
            <li>
              <strong>IPT pagata nella provincia sbagliata.</strong> L&apos;IPT si calcola sulla
              provincia di residenza dell&apos;acquirente, non del venditore. Se sbagli, devi
              richiedere il rimborso e ripagare correttamente.
            </li>
            <li>
              <strong>Documenti scaduti.</strong> Carta d&apos;identità scaduta o libretto con
              annotazioni mancanti (es. fermo amministrativo) bloccano la procedura.
              Controlla tutto prima.
            </li>
            <li>
              <strong>Dimenticare il passaggio a polizza assicurativa.</strong> Dal momento del
              passaggio devi anche aggiornare la polizza RCA: la compagnia va informata e
              spesso il premio si ricalcola.
            </li>
            <li>
              <strong>Ritardare oltre 60 giorni.</strong> Vedi il Callout sopra: sanzione fino
              a 3.629€.
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
