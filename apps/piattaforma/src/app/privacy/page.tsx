import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { JsonLd } from '@/lib/seo/JsonLdScript';
import { webPageJsonLd } from '@/lib/seo/jsonLd';
import { siteUrl } from '@/lib/seo/brand';
import { ART_DATI_TERZI } from '@/lib/legal/clausole-vessatorie';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    "Informativa privacy di Passaggio Veloce: titolare, dati raccolti, finalità, base giuridica, conservazione, fornitori terzi, cookie, DPO, diritti dell'interessato.",
  alternates: { canonical: '/privacy' },
  robots: { index: true, follow: true },
};

/**
 * Privacy Policy per gli UTENTI REGISTRATI (broker e agenzie). I dati di
 * venditori e acquirenti — soggetti terzi che non hanno un rapporto con noi —
 * hanno un'informativa dedicata ex art. 14: `app/privacy/clienti/page.tsx`.
 *
 * Da rivedere con il legale prima dell'entrata in vigore definitiva.
 * Spec: docs/superpowers/specs/2026-07-14-gdpr-dati-terzi-design.md
 *
 * Revisione 2026-07-26 — merge del documento «PassaggioVeloce Privacy COMPLETO
 * FINALE» (v6). Sezioni nuove: sub-utenti e log di accesso (con relativa
 * retention di 24 mesi), informativa specifica sui dati di venditori e
 * acquirenti, Stripe fra i fornitori (doppio livello: responsabile per i
 * pagamenti su nostro incarico, titolare autonomo per le proprie finalità),
 * cessione d'azienda, cookie policy, DPO e istruzioni pratiche per il reclamo
 * al Garante.
 *
 * NON è una riscrittura integrale: quanto già presente qui e assente dal
 * documento è stato mantenuto — in particolare i «Dati finanziari» e la
 * finalità commerciale sull'elenco dei contatti emersi dalle pratiche, che
 * descrive un trattamento reale (CRM) e coincide con la clausola
 * {ART_DATI_TERZI}.1 dei Termini. Il documento aggiunge accanto ad essa
 * l'analisi su dati aggregati e anonimizzati: sono due trattamenti distinti,
 * non due versioni dello stesso, e convivono.
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
          lastModified: '2026-07-26',
        })}
      />
      <article className="mx-auto w-full max-w-3xl px-5 py-10 text-[14px] leading-relaxed text-pv-slate-700 sm:px-6">
        <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Privacy Policy
        </h1>
        <p className="mt-2 text-[12px] text-pv-slate-500">
          Ultimo aggiornamento: 2026-07-26
        </p>

        <Section title="Titolare del trattamento">
          <p>
            Passaggio Veloce S.r.l., con sede legale in Italia, è il titolare del trattamento dei dati personali raccolti tramite la piattaforma{' '}
            <code>passaggioveloce.it</code>{' '}e i sottodomini collegati.
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
          <h3 className="mt-2 text-[15px] font-bold text-pv-navy-900">
            Dati degli utenti registrati (broker, agenzie, admin e sub-utenti)
          </h3>
          <ul className="list-disc pl-5">
            <li>
              <strong>Dati di registrazione e profilo</strong>: nome, cognome, codice fiscale, dati anagrafici dell&apos;amministratore o del referente account, ragione sociale, P.IVA, PEC, IBAN, codice SDI, sede legale e sedi operative.
            </li>
            <li>
              <strong>Dati degli utenti operativi e sub-utenti</strong>: per ciascun dipendente o collaboratore che accede alla Piattaforma su delega dell&apos;Utente titolare trattiamo nome, cognome, indirizzo email, credenziali di accesso (hash della password), ruolo e permessi assegnati. L&apos;Utente titolare è tenuto a informare preventivamente i sub-utenti del trattamento dei loro dati da parte di Passaggio Veloce, prima della creazione delle relative utenze, ai sensi della clausola 2 dei{' '}
              <Link href="/termini" className="font-semibold text-pv-navy-700 hover:underline">
                Termini e Condizioni
              </Link>
              . Passaggio Veloce è manlevata da qualsiasi pretesa dei sub-utenti derivante dalla mancata informativa imputabile all&apos;Utente titolare.
            </li>
            <li>
              <strong>Log di accesso e attività</strong>: registriamo un numero <strong>circoscritto</strong> di eventi, non ogni operazione svolta sulla Piattaforma. Precisamente: (a) <strong>accessi</strong> — login riuscito, logout e <strong>tentativi di accesso falliti</strong>; (b) <strong>accesso ai documenti</strong> — ogni volta che un documento viene aperto o scaricato, inclusi i tentativi <strong>respinti</strong> perché l&apos;utente non ne aveva diritto; (c) <strong>esportazioni massive di dati</strong> (file CSV o ZIP, elenchi di contatti). Di ciascun evento conserviamo data e ora, l&apos;utente e l&apos;azienda che lo ha compiuto, l&apos;azienda i cui dati sono stati interessati, la risorsa toccata, l&apos;<strong>indirizzo IP anonimizzato</strong> e il browser utilizzato. Base giuridica: <strong>legittimo interesse</strong> (art. 6.1.f GDPR) alla sicurezza della Piattaforma, alla prevenzione delle frodi e alla difesa in eventuali controversie, e adempimento dell&apos;obbligo di adottare misure di sicurezza adeguate (art. 32 GDPR). Periodo di conservazione: <strong>24 mesi</strong>, dopo i quali i log sono cancellati automaticamente.
            </li>
            <li>
              <strong>Tracciamento delle operazioni sulle pratiche</strong>: separatamente dai log di cui sopra, ogni cambio di stato di una pratica è registrato con l&apos;indicazione di chi lo ha determinato e quando, insieme allo storico delle comunicazioni email inviate. Serve a ricostruire la lavorazione di una pratica in caso di contestazione ed è conservato insieme ai dati della pratica.
            </li>
            <li>
              <strong>Dati operativi</strong>: documenti caricati per le pratiche (libretto di circolazione, carta d&apos;identità, patente, passaporto, codice fiscale, visure), dati estratti via OCR, comunicazioni con le agenzie.
            </li>
            <li>
              <strong>Dati finanziari</strong>: addebiti, payout, transazioni wallet (importi e timestamp; i dati di pagamento sono trattati direttamente dal processor).
            </li>
            <li>
              <strong>Dati tecnici</strong>: indirizzo IP (anonimizzato a 3 ottetti), user-agent, log di accesso.
            </li>
            <li>
              <strong>Dati di utilizzo raccolti via Google Analytics 4</strong>, e <strong>solo se hai prestato il consenso</strong>: pagine visitate, percorso di navigazione, provenienza, tipo di dispositivo e browser, dati approssimativi di localizzazione derivati dall&apos;indirizzo IP. Google Analytics assegna al browser un identificativo pseudonimo (cookie <code>_ga</code>) e non riceve da noi il tuo nome, l&apos;email o i documenti della pratica. In assenza di consenso lo script di Google non viene caricato e nessuno di questi dati viene raccolto: v. la sezione Cookie Policy più sotto.
            </li>
          </ul>

          <h3 className="mt-4 text-[15px] font-bold text-pv-navy-900">
            Dati di venditori e acquirenti (Terzi)
          </h3>
          <p>
            I dati personali di venditori e acquirenti — soggetti terzi rispetto all&apos;utente registrato — sono conferiti dall&apos;utente per la lavorazione della pratica. Quando la pratica lo richiede includono <strong>permesso di soggiorno</strong>, <strong>certificato di morte</strong>{' '}e atti di successione, procure e autorizzazioni del giudice tutelare. Rispetto a questi dati Passaggio Veloce è <strong>titolare autonomo</strong>: v.{' '}
            <Link
              href="/privacy/clienti"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              informativa per venditori e acquirenti
            </Link>
            . La comunicazione di tali dati a Passaggio Veloce avviene sotto la <strong>responsabilità esclusiva</strong>{' '}dell&apos;utente broker o agenzia che li carica, il quale garantisce di avere titolo per farlo e di aver reso ai Terzi le informative dovute ai sensi dell&apos;art. 13 GDPR.
          </p>
        </Section>

        <Section title="Finalità e basi giuridiche">
          <ul className="list-disc pl-5">
            <li>
              Esecuzione del contratto e gestione delle pratiche di passaggio di proprietà (art. 6.1.b GDPR).
            </li>
            <li>
              Adempimenti fiscali e contabili (art. 6.1.c GDPR).
            </li>
            <li>
              Sicurezza della piattaforma, anti-abuso e investigazione di eventuali frodi (legittimo interesse, art. 6.1.f GDPR).
            </li>
            <li>
              Registrazione degli accessi, degli accessi ai documenti e delle esportazioni di dati per finalità di sicurezza, prevenzione delle frodi e difesa in giudizio (legittimo interesse, art. 6.1.f GDPR, e misure di sicurezza ex art. 32 GDPR). Questa registrazione è <strong>indipendente dal consenso ai cookie</strong>: riguarda la sicurezza del servizio, non la misurazione dell&apos;utilizzo, e non viene disattivata rifiutando le statistiche.
            </li>
            <li>
              Comunicazioni di servizio sul ciclo di vita della pratica (esecuzione del contratto).
            </li>
            <li>
              Analisi e miglioramento del servizio tramite <strong>dati aggregati e anonimizzati</strong>{' '}— dati che non consentono l&apos;identificazione dei singoli utenti (legittimo interesse, art. 6.1.f GDPR).
            </li>
            <li>
              <strong>Statistiche di utilizzo tramite Google Analytics 4</strong>, per capire come viene usata la piattaforma e migliorarla: base giuridica il tuo <strong>consenso</strong>{' '}(art. 6.1.a GDPR), prestato tramite il banner cookie e <strong>revocabile in ogni momento</strong>, senza pregiudicare la liceità del trattamento svolto prima della revoca. Nessun&apos;altra funzione dipende da questo consenso: negarlo non limita in alcun modo l&apos;uso della Piattaforma.
            </li>
            <li>
              Sviluppo e miglioramento del servizio, e finalità commerciali, tramite un elenco aggregato dei contatti (nome, contatti, identificativo fiscale, numero di pratiche) emersi dalle pratiche gestite (legittimo interesse, art. 6.1.f GDPR). Puoi opporti in ogni momento (art. 21 GDPR) scrivendo a{' '}
              <a
                href="mailto:privacy@passaggioveloce.it"
                className="font-semibold text-pv-navy-700 hover:underline"
              >
                privacy@passaggioveloce.it
              </a>
              .
            </li>
          </ul>
        </Section>

        <Section title="Conservazione">
          <ul className="list-disc pl-5">
            <li>
              <strong>Documenti rimossi</strong>: cancellati definitivamente (dal database e dallo storage) <strong>90 giorni</strong>{' '}dopo la rimozione.
            </li>
            <li>
              <strong>Pratiche in bozza mai inviate</strong>, con i relativi documenti: eliminate dopo <strong>30 giorni</strong>.
            </li>
            <li>
              <strong>Dati delle pratiche portate a termine e dati contabili e fiscali</strong>: conservati per il periodo imposto dalla normativa fiscale italiana (<strong>minimo 10 anni</strong>) e dagli obblighi connessi agli adempimenti sul veicolo.
            </li>
            <li>
              <strong>Log di accesso e attività</strong>: conservati per <strong>24 mesi</strong>{' '}dalla data di registrazione, poi <strong>cancellati automaticamente</strong>{' '}da una procedura giornaliera. Non sono conservati oltre tale termine per alcuna finalità.
            </li>
            <li>
              <strong>Dati degli utenti operativi e sub-utenti</strong> (nome, cognome, email, ruolo): conservati per tutta la durata del rapporto contrattuale con l&apos;Utente titolare e per <strong>24 mesi</strong>{' '}dalla cessazione dell&apos;account o dalla revoca dell&apos;utenza, salvo obblighi di legge che richiedano una conservazione più lunga.
            </li>
            <li>
              <strong>Dati di un account eliminato</strong>: soft-deleted per <strong>90 giorni</strong>{' '}e poi rimossi, fatti salvi gli obblighi di conservazione di legge.
            </li>
            <li>
              <strong>Dati di venditori e acquirenti (Terzi)</strong>: conservati per la durata necessaria all&apos;erogazione del servizio e successivamente per il periodo imposto dalla normativa fiscale (<strong>minimo 10 anni</strong>). Decorso tale periodo, i dati sono cancellati salvo ulteriori obblighi di legge.
            </li>
          </ul>
        </Section>

        <Section title="Diritti dell'interessato">
          <p>
            Hai diritto di chiedere accesso, rettifica, cancellazione, limitazione, opposizione e portabilità dei tuoi dati personali. Hai inoltre diritto di proporre reclamo al Garante per la Protezione dei Dati Personali (
            <a
              href="https://www.garanteprivacy.it"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              garanteprivacy.it
            </a>
            ) — v. la sezione &laquo;Reclamo al Garante&raquo; in fondo a questa pagina.
          </p>
          <p>
            Per esercitare i tuoi diritti scrivi a{' '}
            <a
              href="mailto:privacy@passaggioveloce.it"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              privacy@passaggioveloce.it
            </a>
            .
          </p>
        </Section>

        <Section title="Dati di venditori e acquirenti — informativa specifica">
          <p>
            Passaggio Veloce riceve i dati personali di venditori e acquirenti (Terzi) direttamente dai broker e dalle agenzie che li caricano sulla Piattaforma nell&apos;ambito della gestione delle pratiche. Rispetto a tali dati, Passaggio Veloce è <strong>titolare autonomo del trattamento</strong>{' '}ai sensi dell&apos;art. 4 n. 7 GDPR.
          </p>
          <ul className="list-disc pl-5">
            <li>
              <strong>Finalità</strong>: (a) erogazione del servizio e gestione della pratica; (b) invio di comunicazioni email al venditore e/o all&apos;acquirente sull&apos;avanzamento della pratica; (c) adempimenti fiscali e contabili; (d) prevenzione delle frodi e sicurezza della Piattaforma; (e) adempimento di obblighi di legge.
            </li>
            <li>
              <strong>Base giuridica</strong>: esecuzione di un compito nell&apos;interesse del Terzo (art. 6.1.b GDPR) e legittimo interesse di Passaggio Veloce (art. 6.1.f GDPR) per le finalità di cui ai punti (c), (d) ed (e); obbligo legale (art. 6.1.c GDPR) per gli adempimenti fiscali.
            </li>
            <li>
              <strong>Conservazione</strong>: per il periodo necessario all&apos;erogazione del servizio e successivamente per il periodo imposto dalla normativa fiscale italiana (minimo 10 anni). Decorso tale periodo, i dati sono cancellati.
            </li>
            <li>
              <strong>Diritti dei Terzi</strong>: venditori e acquirenti possono esercitare i propri diritti scrivendo a{' '}
              <a
                href="mailto:privacy@passaggioveloce.it"
                className="font-semibold text-pv-navy-700 hover:underline"
              >
                privacy@passaggioveloce.it
              </a>
              . L&apos;informativa completa è disponibile su{' '}
              <Link
                href="/privacy/clienti"
                className="font-semibold text-pv-navy-700 hover:underline"
              >
                passaggioveloce.it/privacy/clienti
              </Link>
              .
            </li>
            <li>
              <strong>Responsabilità dell&apos;utente</strong>: la comunicazione dei dati dei Terzi a Passaggio Veloce avviene sotto la responsabilità esclusiva dell&apos;utente che li carica. Passaggio Veloce è manlevata da qualsiasi pretesa dei Terzi derivante da trattamento non autorizzato imputabile all&apos;utente, ai sensi della clausola {ART_DATI_TERZI}.5 dei{' '}
              <Link href="/termini" className="font-semibold text-pv-navy-700 hover:underline">
                Termini e Condizioni
              </Link>
              .
            </li>
          </ul>
        </Section>

        <Section title="Fornitori terzi e responsabili del trattamento">
          <p>
            Per erogare il servizio ci avvaliamo dei seguenti fornitori terzi:
          </p>
          <ul className="list-disc pl-5">
            <li>
              <strong>Google Cloud – Document AI</strong>: lettura automatica (OCR) dei documenti caricati per la verifica di identità e requisiti (KYC). Agisce come responsabile del trattamento per nostro conto. Regione di trattamento: Unione Europea.
            </li>
            <li>
              <strong>Google Maps Platform</strong>: completamento e validazione dell&apos;indirizzo aziendale e calcolo della distanza geografica per il matching delle agenzie. Agisce come responsabile del trattamento per nostro conto.
            </li>
            <li>
              <strong>Resend</strong>: invio delle email transazionali (conferme, notifiche, reset password). Agisce come responsabile del trattamento per nostro conto. Trattamento nell&apos;Unione Europea.
            </li>
            <li>
              <strong>Vercel</strong>: hosting e distribuzione dell&apos;applicazione. Agisce come responsabile del trattamento per nostro conto.
            </li>
            <li>
              <strong>Neon</strong>: database gestito (PostgreSQL). Agisce come responsabile del trattamento per nostro conto. Regione Unione Europea.
            </li>
            <li>
              <strong>Vercel Blob</strong>: archiviazione dei documenti caricati (libretti, documenti di identità, visure). Agisce come responsabile del trattamento per nostro conto.
            </li>
            <li>
              <strong>Google Ireland Ltd. – Google Analytics 4</strong>: statistiche di utilizzo della Piattaforma. Agisce come responsabile del trattamento per nostro conto in forza delle condizioni di trattamento dei dati di Google Analytics. Attivo <strong>solo previo consenso</strong>: senza, lo script non viene caricato. Il trattamento può comportare un trasferimento negli <strong>Stati Uniti</strong>, coperto dalle clausole contrattuali standard (art. 46 GDPR) e dall&apos;adesione di Google al <strong>EU-US Data Privacy Framework</strong>. Conservazione dei dati di utilizzo sulla proprietà GA4: <strong>14 mesi</strong>. Informativa di Google:{' '}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-pv-navy-700 hover:underline"
              >
                policies.google.com/privacy
              </a>
              .
            </li>
            <li>
              <strong>Stripe, Inc.</strong>: processor dei pagamenti per la gestione degli addebiti SEPA e dei payout. Il rapporto con Stripe si articola su <strong>due livelli distinti</strong>: (a) per le operazioni di pagamento eseguite su incarico di Passaggio Veloce (addebiti SEPA, payout verso i broker), Stripe agisce come <strong>responsabile del trattamento</strong> ai sensi dell&apos;art. 28 GDPR, in forza di un Data Processing Agreement stipulato con Passaggio Veloce; (b) per le proprie finalità autonome (prevenzione delle frodi, compliance finanziaria, miglioramento dei propri servizi), Stripe agisce come <strong>titolare autonomo</strong>, soggetto alla propria informativa privacy (
              <a
                href="https://stripe.com/it/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-pv-navy-700 hover:underline"
              >
                stripe.com/it/privacy
              </a>
              ). Il trasferimento di dati verso Stripe può comportare trattamento extra-UE protetto da clausole contrattuali standard (SCC) ai sensi dell&apos;art. 46 GDPR.
            </li>
          </ul>
        </Section>

        <Section title="Trasferimenti internazionali">
          <p>
            La maggior parte dei trattamenti avviene su server nell&apos;Unione Europea (si veda la sezione &laquo;Fornitori terzi&raquo; per i dettagli per singolo fornitore). Alcuni servizi — Sentry per l&apos;error monitoring, Stripe per i pagamenti e <strong>Google Analytics</strong>{' '}per le statistiche di utilizzo — possono comportare trasferimenti extra-UE, in particolare verso gli <strong>Stati Uniti</strong>, protetti da <strong>clausole contrattuali standard</strong>{' '}(SCC) ai sensi dell&apos;art. 46 GDPR e, dove applicabile, dall&apos;adesione del fornitore al EU-US Data Privacy Framework. Il trasferimento legato a Google Analytics avviene <strong>solo se hai prestato il consenso</strong>{' '}e cessa se lo revochi.
          </p>
        </Section>

        <Section title="Cessione d'azienda o acquisizione">
          <p>
            In caso di cessione, fusione, acquisizione o altra operazione straordinaria che coinvolga Passaggio Veloce S.r.l., i dati personali trattati dalla Piattaforma potranno essere trasferiti al soggetto subentrante quale parte degli asset aziendali ceduti. Tale trasferimento avviene sulla base del <strong>legittimo interesse</strong>{' '}di Passaggio Veloce (art. 6.1.f GDPR), in quanto necessario alla continuità del servizio e all&apos;adempimento delle obbligazioni contrattuali in corso.
          </p>
          <p>
            Il soggetto subentrante sarà vincolato al rispetto della presente Informativa Privacy e della normativa applicabile in materia di protezione dei dati. In caso di operazione straordinaria, Passaggio Veloce comunicherà agli Utenti le eventuali modifiche al trattamento dei dati con preavviso adeguato e nel rispetto degli obblighi di legge, incluso il <strong>diritto degli interessati di opporsi</strong>{' '}al trattamento ai sensi dell&apos;art. 21 GDPR.
          </p>
        </Section>

        <Section title="Cookie Policy">
          <p>
            La Piattaforma utilizza <strong>cookie tecnici</strong>, necessari al funzionamento del servizio, e — <strong>soltanto previo consenso</strong>{' '}— i <strong>cookie analitici di Google Analytics 4</strong>. Non sono utilizzati cookie di profilazione pubblicitaria, di tracciamento comportamentale a fini di marketing o di terze parti a scopo pubblicitario.
          </p>
          <p>
            I <strong>cookie tecnici</strong>{' '}utilizzati includono: (a) <strong>cookie di sessione</strong> — necessari per mantenere la sessione dell&apos;Utente autenticato durante la navigazione, eliminati automaticamente alla chiusura del browser; (b) <strong>cookie di preferenze</strong> — necessari per ricordare le impostazioni dell&apos;Utente (lingua, preferenze di visualizzazione, scelta espressa sui cookie), con durata massima di 12 mesi; (c) <strong>cookie di sicurezza</strong> — necessari per prevenire attacchi CSRF (Cross-Site Request Forgery) e garantire la sicurezza delle sessioni, eliminati alla chiusura del browser; (d) <strong>cookie di attribuzione dell&apos;affiliazione</strong>{' '}— cookie di prima parte, di durata 30 giorni, che memorizza il solo identificativo del referente per attribuire le registrazioni effettuate dopo il clic su un link di invito.
          </p>
          <p>
            I <strong>cookie analitici</strong>{' '}di Google Analytics 4 (<code>_ga</code> e <code>_ga_&lt;ID&gt;</code>, durata 2 anni) <strong>non</strong>{' '}sono cookie tecnici: vengono installati <strong>solo dopo il consenso</strong>{' '}prestato tramite il banner. Fino a quel momento lo script di Google non viene neppure scaricato, quindi nessun dato — nemmeno l&apos;indirizzo IP — raggiunge il fornitore. Il consenso è <strong>revocabile in qualunque momento</strong>{' '}dal pulsante &laquo;Gestisci le preferenze cookie&raquo; nella cookie policy: alla revoca il tag è disattivato e i relativi cookie eliminati.
          </p>
          <p>
            I cookie tecnici non richiedono il consenso dell&apos;Utente ai sensi dell&apos;art. 122 del D.Lgs. 196/2003 (Codice Privacy) e del Provvedimento del Garante dell&apos;8 maggio 2014. L&apos;Utente può disabilitare i cookie dal proprio browser, ma ciò potrebbe compromettere il corretto funzionamento della Piattaforma.
          </p>
          <p>
            Qualora in futuro venissero introdotti ulteriori cookie non tecnici, la presente sezione sarà aggiornata e sarà richiesto il consenso esplicito dell&apos;Utente prima dell&apos;attivazione. Il dettaglio dei singoli cookie, con nomi e durate, è nella{' '}
            <Link href="/cookie" className="font-semibold text-pv-navy-700 hover:underline">
              cookie policy
            </Link>
            .
          </p>
        </Section>

        <Section title="Responsabile della Protezione dei Dati (DPO)">
          <p>
            Passaggio Veloce S.r.l. ha valutato l&apos;obbligo di nomina del Responsabile della Protezione dei Dati (DPO) ai sensi dell&apos;art. 37 GDPR. Allo stato attuale, in ragione delle dimensioni dell&apos;organizzazione e della tipologia di dati trattati, <strong>la nomina non è obbligatoria</strong>. Passaggio Veloce si riserva di procedere alla nomina qualora l&apos;evoluzione dell&apos;attività lo rendesse necessario o opportuno.
          </p>
          <p>
            Per qualsiasi questione relativa alla protezione dei dati è possibile contattare il referente interno alla privacy:{' '}
            <a
              href="mailto:privacy@passaggioveloce.it"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              privacy@passaggioveloce.it
            </a>
            .
          </p>
        </Section>

        <Section title="Reclamo al Garante — istruzioni pratiche">
          <p>
            L&apos;interessato ha il diritto di proporre reclamo all&apos;Autorità Garante per la Protezione dei Dati Personali qualora ritenga che il trattamento dei propri dati violi il GDPR o la normativa nazionale applicabile. Il reclamo può essere presentato:
          </p>
          <ul className="list-disc pl-5">
            <li>
              online, tramite il portale del Garante:{' '}
              <a
                href="https://www.garanteprivacy.it"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-pv-navy-700 hover:underline"
              >
                garanteprivacy.it
              </a>
              ;
            </li>
            <li>
              via email all&apos;indirizzo{' '}
              <a
                href="mailto:garante@gpdp.it"
                className="font-semibold text-pv-navy-700 hover:underline"
              >
                garante@gpdp.it
              </a>
              ;
            </li>
            <li>
              via posta ordinaria o raccomandata all&apos;indirizzo: Garante per la Protezione dei Dati Personali, Piazza Venezia 11, 00187 Roma.
            </li>
          </ul>
          <p>
            Prima di presentare reclamo al Garante, ti invitiamo a contattarci all&apos;indirizzo{' '}
            <a
              href="mailto:privacy@passaggioveloce.it"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              privacy@passaggioveloce.it
            </a>
            {' '}per tentare una risoluzione diretta della questione.
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
