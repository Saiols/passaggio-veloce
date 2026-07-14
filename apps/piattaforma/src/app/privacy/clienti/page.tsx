import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { JsonLd } from '@/lib/seo/JsonLdScript';
import { webPageJsonLd } from '@/lib/seo/jsonLd';
import { siteUrl } from '@/lib/seo/brand';

export const metadata: Metadata = {
  title: 'Informativa privacy per venditori e acquirenti',
  description:
    'Come Passaggio Veloce tratta i dati di venditori e acquirenti di un veicolo: da chi li riceviamo, perché, per quanto tempo e quali diritti hai.',
  alternates: { canonical: '/privacy/clienti' },
  robots: { index: true, follow: true },
};

/**
 * Informativa ex art. 14 GDPR verso venditore e acquirente: dati raccolti NON
 * presso l'interessato ma ricevuti dal broker. È un'informativa DIVERSA da
 * /privacy (che parla all'utente registrato: IBAN, Stripe, KYC) e serve a
 * chiudere la lacuna per cui trattavamo i documenti d'identità di persone che
 * non hanno alcun rapporto con noi, e a cui scriviamo email dirette, senza
 * aver mai detto loro chi siamo.
 *
 * PV è TITOLARE AUTONOMO (non responsabile ex art. 28): decidiamo noi il
 * provider OCR, la retention, l'antifrode. Base giuridica: legittimo interesse
 * (6.1.f) + obbligo di legge (6.1.c) — mai il consenso, che sarebbe revocabile
 * a metà pratica.
 *
 * DRAFT: da sottoporre a revisione legale prima del go-live, insieme a
 * /termini (clausola 17) e /privacy.
 * Spec: docs/superpowers/specs/2026-07-14-gdpr-dati-terzi-design.md
 */
export default function PrivacyClientiPage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <JsonLd
        data={webPageJsonLd({
          url: siteUrl('/privacy/clienti'),
          name: 'Informativa privacy per venditori e acquirenti',
          description:
            'Come Passaggio Veloce tratta i dati di venditori e acquirenti di un veicolo.',
          lastModified: '2026-07-14',
        })}
      />
      <article className="mx-auto w-full max-w-3xl px-5 py-10 text-[14px] leading-relaxed text-pv-slate-700 sm:px-6">
        <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Informativa privacy per venditori e acquirenti
        </h1>
        <p className="mt-2 text-[12px] text-pv-slate-500">Ultimo aggiornamento: 2026-07-14</p>

        <p className="mt-4">
          Se stai comprando o vendendo un veicolo e ti sei rivolto a un concessionario, a un
          rivenditore o a un&apos;agenzia di pratiche auto, è possibile che i tuoi dati siano
          arrivati a noi. Questa pagina ti spiega <strong>chi siamo</strong>,{' '}
          <strong>perché abbiamo i tuoi dati</strong> e <strong>cosa puoi chiederci</strong>.
          È l&apos;informativa prevista dall&apos;<strong>art. 14 del GDPR</strong>, quella che
          va data quando i dati non sono raccolti direttamente dalla persona a cui si
          riferiscono.
        </p>

        <Section title="Chi siamo">
          <p>
            <strong>Passaggio Veloce S.r.l.</strong>, con sede legale in Italia, gestisce la
            piattaforma <code>passaggioveloce.it</code>, che mette in contatto gli operatori del
            settore auto con le agenzie di pratiche automobilistiche per gestire i passaggi di
            proprietà. Rispetto ai tuoi dati siamo <strong>titolare del trattamento</strong>.
          </p>
          <p>
            Per qualsiasi richiesta:{' '}
            <a
              href="mailto:privacy@passaggioveloce.it"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              privacy@passaggioveloce.it
            </a>
          </p>
        </Section>

        <Section title="Da dove abbiamo i tuoi dati">
          <p>
            <strong>Non li abbiamo raccolti da te.</strong>{' '}
            Ce li ha trasmessi il professionista a
            cui ti sei rivolto — il concessionario, il rivenditore o l&apos;agenzia che sta
            gestendo la compravendita — per poter lavorare la pratica di passaggio di proprietà.
            Quel professionista è a sua volta titolare del trattamento nei tuoi confronti ed è
            tenuto a informarti prima di trasmetterci i tuoi dati.
          </p>
        </Section>

        <Section title="Quali dati trattiamo">
          <ul className="list-disc pl-5">
            <li>
              <strong>Dati anagrafici e di contatto</strong>: nome, cognome, codice fiscale,
              indirizzo di residenza, email, telefono. Se agisci come impresa: ragione sociale e
              partita IVA.
            </li>
            <li>
              <strong>Documenti di identità</strong>: carta d&apos;identità, patente o passaporto,
              tessera sanitaria / codice fiscale, e i dati che ne estraiamo automaticamente.
            </li>
            <li>
              <strong>Dati del veicolo</strong>: targa, numero di telaio, libretto di
              circolazione, prezzo di vendita.
            </li>
            <li>
              <strong>Documenti particolari, solo quando la pratica li richiede</strong>: permesso
              di soggiorno (se non sei cittadino UE), certificato di morte e atti di successione
              (se il veicolo proviene da un&apos;eredità), procure e deleghe, autorizzazione del
              giudice tutelare (se è coinvolto un minore).
            </li>
          </ul>
        </Section>

        <Section title="Perché li trattiamo e su quale base">
          <ul className="list-disc pl-5">
            <li>
              <strong>Per gestire la pratica</strong> di passaggio di proprietà che il
              professionista ci ha affidato, e per informarti sul suo avanzamento — nostro{' '}
              <strong>legittimo interesse</strong> e interesse tuo a che la pratica vada a buon
              fine (art. 6.1.f GDPR).
            </li>
            <li>
              <strong>Per prevenire le frodi</strong> sui passaggi di proprietà (veicoli con fermi
              amministrativi o ipoteche, documenti non autentici) — legittimo interesse
              (art. 6.1.f GDPR).
            </li>
            <li>
              <strong>Per adempiere agli obblighi di legge</strong>, in particolare quelli fiscali
              e quelli connessi agli adempimenti presso il Pubblico Registro Automobilistico
              (art. 6.1.c GDPR).
            </li>
          </ul>
          <p>
            <strong>Non ti chiediamo un consenso</strong> perché non è su questo che si fonda il
            trattamento: senza i tuoi dati il passaggio di proprietà non si può materialmente
            fare, e alcuni obblighi ci sono imposti dalla legge.
          </p>
        </Section>

        <Section title="A chi comunichiamo i tuoi dati">
          <ul className="list-disc pl-5">
            <li>
              <strong>All&apos;agenzia di pratiche auto</strong> che lavora la tua pratica e presso
              cui firmerai: è un soggetto distinto da noi e tratta i tuoi dati come titolare
              autonomo per gli adempimenti di sua competenza.
            </li>
            <li>
              <strong>Ai nostri fornitori tecnici</strong>, che trattano i dati per nostro conto
              come responsabili del trattamento: <strong>Google Cloud – Document AI</strong>
              {' '}(lettura automatica dei documenti, trattamento in Unione Europea),{' '}
              <strong>Resend</strong> (invio delle email, Unione Europea), <strong>Vercel</strong>{' '}
              (hosting dell&apos;applicazione e archiviazione dei documenti caricati),{' '}
              <strong>Neon</strong> (database, Unione Europea).
            </li>
            <li>
              <strong>Alle autorità</strong>, quando la legge lo impone.
            </li>
          </ul>
          <p>
            <strong>Non vendiamo i tuoi dati</strong> e non li usiamo per inviarti pubblicità.
          </p>
        </Section>

        <Section title="Per quanto tempo li conserviamo">
          <p>
            I documenti che rimuoviamo o che appartengono a pratiche mai completate vengono
            cancellati automaticamente: <strong>90 giorni</strong> dalla rimozione per i documenti,{' '}
            <strong>30 giorni</strong> per le pratiche rimaste in bozza e mai inviate.
          </p>
          <p>
            I dati delle pratiche <strong>portate a termine</strong> restano conservati per il
            tempo imposto dalla normativa fiscale e dagli obblighi connessi agli adempimenti sul
            veicolo.
          </p>
        </Section>

        <Section title="I tuoi diritti">
          <p>
            Puoi chiederci in ogni momento di <strong>accedere</strong> ai tuoi dati, di{' '}
            <strong>correggerli</strong>, di <strong>cancellarli</strong>, di{' '}
            <strong>limitarne</strong> il trattamento o di <strong>riceverli</strong> in un
            formato leggibile (artt. 15-20 GDPR).
          </p>
          <p>
            Poiché una parte del trattamento si fonda sul nostro legittimo interesse, hai anche il{' '}
            <strong>diritto di opporti</strong> (art. 21 GDPR). Tieni presente che se ti opponi
            mentre la pratica è in corso, il passaggio di proprietà potrebbe non poter essere
            completato; alcuni dati, inoltre, dobbiamo conservarli per obbligo di legge anche dopo
            una richiesta di cancellazione.
          </p>
          <p>
            Scrivi a{' '}
            <a
              href="mailto:privacy@passaggioveloce.it"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              privacy@passaggioveloce.it
            </a>
            . Se ritieni che i tuoi dati siano trattati in modo scorretto puoi proporre reclamo al{' '}
            <a
              href="https://www.garanteprivacy.it"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              Garante per la Protezione dei Dati Personali
            </a>
            .
          </p>
        </Section>

        <p className="mt-8 text-[11px] text-pv-slate-500">
          Documento in versione tecnica, soggetto a revisione legale prima dell&apos;entrata in
          vigore definitiva. Vedi anche l&apos;
          <Link href="/privacy" className="font-semibold text-pv-navy-700 hover:underline">
            informativa per gli utenti registrati
          </Link>{' '}
          e la{' '}
          <Link href="/cookie" className="font-semibold text-pv-navy-700 hover:underline">
            cookie policy
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
