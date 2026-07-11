import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { JsonLd } from '@/lib/seo/JsonLdScript';
import { webPageJsonLd } from '@/lib/seo/jsonLd';
import { siteUrl } from '@/lib/seo/brand';

export const metadata: Metadata = {
  title: 'Termini e Condizioni',
  description:
    'Termini e Condizioni di utilizzo della piattaforma Passaggio Veloce: prezzo del servizio, affiliazione, wallet e payout, fatturazione conto terzi, regime fiscale, responsabilità, foro competente.',
  alternates: { canonical: '/termini' },
  robots: { index: true, follow: true },
};

/**
 * Termini e Condizioni di utilizzo (contratto B2B). Draft tecnico completo:
 * DA SOTTOPORRE A REVISIONE LEGALE prima del go-live, in particolare la clausola 3
 * (variazione prezzo a discrezione), le manleve (8) e le limitazioni di
 * responsabilità (12). Le clausole vessatorie ex artt. 1341-1342 c.c. sono
 * elencate alla clausola 17 e richiedono la seconda accettazione specifica
 * raccolta in fase di registrazione.
 *
 * Revisione 2026-07-11: riscritte le clausole 5 (prelievo — un wallet per
 * sede + wallet madre affiliazione, soglia di accumulo per wallet, nessuna
 * decadenza, liquidazione del residuo alla cessazione), 10 (penali —
 * esaustiva e tassativa) e 11 (limitazione / sospensione / cancellazione —
 * quattro misure distinte, motivi tassativi, incl. 11.3-bis sospensione
 * della singola utenza). Spec:
 * docs/superpowers/specs/2026-07-11-termini-penali-sospensione-design.md
 */
export default function TerminiPage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <JsonLd
        data={webPageJsonLd({
          url: siteUrl('/termini'),
          name: 'Termini e Condizioni',
          description: 'Termini e Condizioni di utilizzo di Passaggio Veloce.',
        })}
      />
      <article className="mx-auto w-full max-w-3xl px-5 py-10 text-[14px] leading-relaxed text-pv-slate-700 sm:px-6">
        <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Termini e Condizioni di Utilizzo
        </h1>
        <p className="mt-2 text-[12px] text-pv-slate-500">Ultimo aggiornamento: 2026-07-11</p>

        <p className="mt-4">
          I presenti Termini e Condizioni (i &laquo;<strong>Termini</strong>&raquo;) disciplinano
          l&apos;utilizzo della piattaforma <strong>Passaggio Veloce</strong> (la
          &laquo;Piattaforma&raquo;), gestita da <strong>Passaggio Veloce S.r.l.</strong>
          (&laquo;Passaggio Veloce&raquo;, &laquo;noi&raquo;), da parte degli operatori
          professionali che vi si registrano (l&apos;&laquo;<strong>Utente</strong>&raquo;: broker /
          dealer e agenzie di pratiche automobilistiche). La registrazione e l&apos;uso della
          Piattaforma comportano l&apos;accettazione integrale dei presenti Termini. Il servizio è
          riservato a soggetti che agiscono nell&apos;esercizio della propria attività
          d&apos;impresa o professione (rapporto <strong>B2B</strong>).
        </p>

        <Section title="1. Definizioni e oggetto del servizio">
          <p>
            Passaggio Veloce è una piattaforma B2B di intermediazione tecnologica che mette in
            contatto <strong>broker</strong> (dealer/concessionarie auto) con{' '}
            <strong>agenzie</strong> di pratiche automobilistiche per la gestione di passaggi di
            proprietà, minivolture e servizi correlati, fornendo strumenti di distribuzione delle
            pratiche, tracciamento, gestione dei compensi e fatturazione.
          </p>
          <p>
            Passaggio Veloce <strong>non è parte</strong> del contratto di esecuzione della pratica
            automobilistica, che resta tra il broker e l&apos;agenzia assegnata. Passaggio Veloce
            non presta consulenza automobilistica, fiscale o legale e non risponde dell&apos;esito
            della singola pratica.
          </p>
        </Section>

        <Section title="2. Registrazione, account e verifica (KYC)">
          <p>
            Per utilizzare la Piattaforma l&apos;Utente si registra fornendo dati aziendali
            veritieri, completi e aggiornati (ragione sociale, partita IVA, sede, regime fiscale,
            contatti, IBAN) e i documenti richiesti per la verifica antifrode e di identità (KYC),
            tra cui documento d&apos;identità del legale rappresentante, codice fiscale e visura
            camerale.
          </p>
          <p>
            La registrazione genera un unico account amministratore titolare, cui l&apos;Utente può
            associare ulteriori utenze e sedi operative. L&apos;Utente è responsabile della
            riservatezza delle credenziali, dell&apos;operato delle utenze da esso create e della
            veridicità di ogni dato e documento caricato, anche relativo alle pratiche.
          </p>
        </Section>

        <Section title="3. Prezzo del servizio (fee a carico dell'agenzia)">
          <p>
            A fronte del servizio di intermediazione, per <strong>ogni pratica accettata</strong>{' '}
            dall&apos;agenzia e ricevuta tramite la Piattaforma è dovuto a Passaggio Veloce un
            corrispettivo <strong>variabile compreso tra 1 € e 200 €</strong> per pratica. Il
            corrispettivo applicabile è indicato in Piattaforma al momento dell&apos;invio/accettazione
            della pratica.
          </p>
          <p>
            <strong>
              Passaggio Veloce si riserva il diritto di variare il prezzo del servizio, entro il
              predetto intervallo, a propria discrezione e senza alcuna limitazione
            </strong>
            , anche in relazione alla tipologia di pratica, alla zona e alle condizioni di mercato.
            L&apos;agenzia accetta espressamente tale facoltà di variazione (clausola vessatoria: v.
            clausola 17).
          </p>
        </Section>

        <Section title="4. Programma di affiliazione">
          <p>
            L&apos;Utente può invitare altri operatori tramite un proprio link di affiliazione. Per
            ogni pratica generata da un utente registrato tramite tale link è riconosciuta una
            commissione di affiliazione <strong>compresa tra 1 € e 10 €</strong> per pratica,
            dovuta <strong>unicamente ed esclusivamente a pratica firmata</strong> (non alla sola
            accettazione o invio).
          </p>
          <p>
            Qualora a una medesima pratica siano collegati <strong>due</strong> soggetti affiliati
            &mdash; ossia sia il broker sia l&apos;agenzia risultino iscritti tramite referral
            &mdash; la commissione di affiliazione è <strong>ripartita (splittata) tra i due
            referenti</strong>, secondo i criteri indicati in Piattaforma. In presenza di un solo
            referente, la commissione è a questi integralmente riconosciuta.
          </p>
          <p>
            Le commissioni sono accreditate sul wallet del soggetto referente e sono soggette ai
            controlli anti-collusione: Passaggio Veloce può sospendere, non riconoscere o stornare
            commissioni in caso di abuso, iscrizioni fittizie o collusione tra soggetti collegati.
          </p>
        </Section>

        <Section title="5. Wallet, compensi e condizioni di prelievo (payout)">
          <p>
            I compensi maturati dall&apos;Utente sono accreditati sul wallet <strong>alla firma</strong> della relativa pratica. <strong>Il saldo del wallet è in ogni momento e integralmente di spettanza dell&apos;Utente: non è soggetto a scadenza né a decadenza; le uniche variazioni in diminuzione, diverse dall&apos;erogazione dei payout, sono quelle previste dalle clausole 10.4 (penale), 10.5(b) (storno del compenso non maturato) e 10.8 (rettifiche contabili).</strong>
          </p>
          <p>
            L&apos;Utente dispone di <strong>portafogli distinti</strong>: <strong>un wallet per ciascuna sede operativa</strong>, sul quale confluiscono i compensi delle pratiche lavorate da quella sede (ed eventuali bonus promozionali), e — ove applicabile — <strong>un unico wallet aziendale</strong> per le <strong>commissioni di affiliazione</strong> (clausola 4). Un Utente con più sedi dispone pertanto di più wallet di sede, <strong>ciascuno con contabilità separata</strong> quanto agli accrediti e alla soglia di accumulo per la richiesta di prelievo, <strong>fermo restando quanto previsto al quarto comma della presente clausola in caso di saldo negativo su uno qualsiasi dei wallet dell&apos;Utente</strong>. I compensi <strong>si accumulano liberamente</strong> su ciascun wallet. La <strong>richiesta di prelievo</strong> può essere presentata, <strong>per ciascun wallet separatamente</strong>, una volta raggiunto su di esso un saldo di <strong>500 €</strong>; al di sotto di tale importo i compensi <strong>restano accreditati e continuano ad accumularsi senza alcuna perdita</strong>. Al raggiungimento della soglia di payout automatico configurata dall&apos;Utente (di regola 1.000 €, impostabile tra 1.000 € e 5.000 €) l&apos;erogazione è avviata automaticamente, wallet per wallet. L&apos;erogazione avviene mediante bonifico sull&apos;IBAN indicato.
          </p>
          <p>
            <strong>In ogni caso di cessazione del rapporto</strong> (recesso di una delle parti, chiusura o cancellazione dell&apos;account) <strong>il saldo residuo è liquidato integralmente all&apos;Utente anche se inferiore a 500 €</strong>, previa emissione dei documenti fiscali e regolarizzazione di quanto eventualmente dovuto a Passaggio Veloce. Qualora un wallet dell&apos;Utente presenti saldo negativo, <strong>la liquidazione è sospesa fino alla regolarizzazione del debito</strong>.
          </p>
          <p>
            In caso di penali (clausola 10) il saldo di un wallet può risultare negativo: in tale ipotesi <strong>i prelievi sono sospesi su tutti i wallet dell&apos;Utente</strong> (ogni sede e, ove presente, il wallet aziendale di affiliazione) <strong>e non soltanto su quello in negativo</strong>, fino al ripristino di un saldo non negativo su quest&apos;ultimo; nel frattempo i compensi successivi continuano ad accreditarsi liberamente su ciascun wallet, anche a compensazione del saldo negativo. <strong>L&apos;operatività dell&apos;Utente nella gestione delle pratiche resta invariata.</strong> L&apos;Utente accetta espressamente le presenti condizioni di prelievo, inclusa la soglia di richiesta del payout e la sospensione dei prelievi su tutti i wallet in caso di saldo negativo di uno solo di essi (clausola vessatoria: v. clausola 17).
          </p>
        </Section>

        <Section title="6. Fatturazione per conto terzi (fatturazione delegata)">
          <p>
            L&apos;Utente <strong>conferisce mandato a Passaggio Veloce</strong> a emettere, in nome
            e/o per conto dell&apos;Utente stesso, i documenti fiscali relativi ai compensi maturati
            sulla Piattaforma (<strong>fatturazione per conto terzi</strong>), nonché a gestire la
            relativa numerazione e trasmissione tramite Sistema di Interscambio (SDI) secondo la
            normativa italiana sulla fatturazione elettronica B2B.
          </p>
          <p>
            L&apos;Utente si obbliga a fornire e mantenere aggiornati tutti i dati necessari alla
            corretta emissione dei documenti fiscali e riconosce come validamente emessi i documenti
            generati da Passaggio Veloce nell&apos;esercizio di tale mandato.
          </p>
        </Section>

        <Section title="7. Regime fiscale e determinazione differenziata del compenso">
          <p>
            Il trattamento economico e fiscale dei compensi varia in funzione del{' '}
            <strong>regime fiscale</strong> dichiarato dall&apos;Utente (a titolo esemplificativo:
            società/azienda, ditta individuale in regime ordinario, ditta individuale in regime
            forfettario). L&apos;Utente è tenuto a dichiarare il proprio regime in modo veritiero e a
            comunicarne tempestivamente le variazioni.
          </p>
          <p>
            In particolare, per gli Utenti in <strong>regime forfettario</strong>, non applicando
            questi l&apos;IVA, Passaggio Veloce <strong>tratterrà la differenza corrispondente
            all&apos;IVA</strong> e l&apos;importo erogato all&apos;Utente sarà conseguentemente{' '}
            <strong>inferiore</strong> rispetto a quello riconosciuto ai soggetti che applicano
            l&apos;IVA. L&apos;Utente accetta espressamente tale meccanismo di determinazione
            differenziata del compenso (clausola vessatoria: v. clausola 17).
          </p>
        </Section>

        <Section title="8. Visura camerale: aggiornamento, responsabilità e manleva">
          <p>
            L&apos;Utente è <strong>responsabile del costante aggiornamento</strong> della propria
            visura camerale e degli altri dati anagrafici e fiscali sulla Piattaforma. Passaggio
            Veloce si basa sui dati e documenti forniti dall&apos;Utente per la gestione dei compensi
            e della fatturazione.
          </p>
          <p>
            L&apos;Utente <strong>manleva e tiene indenne Passaggio Veloce</strong> da ogni pretesa,
            danno, sanzione o onere derivante da dati o documenti non veritieri, incompleti o non
            aggiornati (inclusa la visura), affinché sia garantita una gestione corretta della
            fatturazione, anche nell&apos;ambito della fatturazione per conto terzi di cui alla
            clausola 6. L&apos;Utente accetta espressamente la presente manleva (clausola vessatoria:
            v. clausola 17).
          </p>
        </Section>

        <Section title="9. Mandato di addebito diretto SEPA (agenzie)">
          <p>
            Le agenzie autorizzano Passaggio Veloce ad addebitare il proprio conto mediante addebito
            diretto SEPA (SEPA Direct Debit) per gli importi delle fee dovute ai sensi della clausola
            3, secondo le tempistiche indicate in Piattaforma. Il mandato è revocabile secondo lo
            standard SDD; la revoca non fa venir meno gli importi già maturati.
          </p>
        </Section>

        {/*
          L'importo "€ 25,00" scritto nel testo (punto 10.4) è una costante del
          contratto, non un calcolo: deve coincidere con
          PENALI.PENALE_BROKER_DEFAULT_CENT (lib/penali/config.ts, oggi 2_500
          cent = € 25,00). Se quella costante cambia, questo testo va aggiornato
          a mano.
        */}
        <Section title="10. Sistema di segnalazioni e penali">
          <p>
            <strong>10.1 &mdash; Verifica preventiva a carico del broker.</strong> Passaggio Veloce <strong>non effettua visure PRA</strong>. Prima dell&apos;invio di ogni pratica il broker verifica personalmente, <strong>per ciascun veicolo</strong>, che: (a) non sussistano fermi amministrativi; (b) non sussistano ipoteche o vincoli iscritti al PRA; (c) i documenti caricati siano autentici e corrispondenti al veicolo. Tale verifica forma oggetto di <strong>dichiarazione espressa</strong> resa in Piattaforma prima di ogni invio, registrata con data, ora e versione del testo accettato.
          </p>
          <p>
            <strong>10.2 &mdash; Segnalazione dell&apos;agenzia.</strong> La sola <strong>agenzia assegnataria</strong> può segnalare, <strong>esclusivamente prima della firma</strong> (pratica in stato &laquo;Accettata&raquo; o &laquo;Processata&raquo;): <strong>fermo amministrativo</strong>, <strong>ipoteca o vincolo PRA</strong>, <strong>documento non valido</strong>, <strong>altro</strong> (con nota). L&apos;agenzia <strong>indica i veicoli interessati</strong>. Dopo la firma la pratica è chiusa e non è più segnalabile.
          </p>
          <p>
            <strong>10.3 &mdash; Verifica di Passaggio Veloce. Nessuna penale è mai applicata automaticamente.</strong> Ogni segnalazione è verificata da Passaggio Veloce, che può <strong>confermarla</strong> (pratica annullata, penale addebitata) o <strong>respingerla</strong> (pratica prosegue, nessun addebito). L&apos;esito è comunicato via email a entrambe le parti.
          </p>
          <p>
            <strong>10.4 &mdash; Penale: unica penale prevista.</strong> In caso di segnalazione <strong>confermata</strong> è addebitata al broker una penale di <strong>€ 25,00 per ciascun veicolo oggetto della segnalazione confermata</strong>. La penale: (a) è addebitata sul wallet del broker; (b) <strong>non è soggetta a IVA</strong>, costituendo somma dovuta a titolo di penalità, esclusa dalla base imponibile ai sensi dell&apos;<strong>art. 15, co. 1, n. 1, D.P.R. 633/1972</strong>; (c) <strong>non si applica ai veicoli non segnalati</strong> della medesima pratica.
          </p>
          <p className="italic">
            Esempio: pratica con 3 veicoli, di cui 1 con fermo confermato → penale € 25,00 (un solo veicolo), non € 75,00.
          </p>
          <p>
            <strong>10.5 &mdash; Effetti della conferma.</strong> (a) la pratica è <strong>annullata</strong>; (b) il compenso della pratica <strong>non è maturato</strong> dal broker, poiché matura solo alla firma (se già eccezionalmente accreditato, è stornato); (c) all&apos;agenzia segnalante <strong>non è addebitata alcuna fee</strong>.
          </p>
          <p>
            <strong>10.6 &mdash; Saldo negativo.</strong> L&apos;addebito può portare il wallet della sede a saldo negativo. In tal caso, come previsto dalla clausola 5, <strong>i prelievi sono sospesi su tutti i wallet dell&apos;Utente</strong> (non solo su quello addebitato) fino al ripristino di un saldo non negativo su quest&apos;ultimo; i compensi successivi si accreditano liberamente a compensazione, e <strong>l&apos;operatività resta invariata</strong>: il broker può continuare a caricare e gestire pratiche.
          </p>
          <p>
            <strong>10.7 &mdash; Reiterazione.</strong> Al raggiungimento di <strong>2 penali confermate</strong>, la posizione del broker è sottoposta a valutazione ai fini della sospensione ai sensi della clausola 11.
          </p>
          <p>
            <strong>10.8 &mdash; Tassatività.</strong> La penale di cui al punto 10.4 è <strong>l&apos;unica penale</strong> applicata da Passaggio Veloce. Oltre ad essa e al corrispettivo di cui alla clausola 3, <strong>nessun altro importo è addebitato all&apos;Utente a titolo di penale, sanzione o costo</strong>. Restano salve le sole <strong>rettifiche contabili</strong> volte a correggere accrediti o addebiti erronei, prive di natura sanzionatoria e sempre motivate e tracciate nel wallet. L&apos;Utente accetta espressamente il presente sistema di segnalazioni e penali (clausola vessatoria: v. clausola 17).
          </p>
        </Section>

        <Section title="11. Limitazione operativa, sospensione e cancellazione dell'account">
          <p>
            Passaggio Veloce adotta <strong>quattro misure distinte</strong>, di gravità crescente, di seguito elencate <strong>in modo tassativo</strong>.
          </p>
          <p>
            <strong>11.1 &mdash; Limitazione operativa per mancato incasso della fee (solo agenzie).</strong> <em>Presupposto:</em> l&apos;addebito SEPA della fee (clausola 3) non va a buon fine. <em>Effetto:</em> l&apos;agenzia <strong>conserva l&apos;accesso alla Piattaforma</strong> &mdash; <strong>l&apos;account NON è sospeso</strong> &mdash; ma è esclusa dalla distribuzione di nuove pratiche e non può accettare, lavorare o portare a firma pratiche fino alla regolarizzazione. <em>Rimedio:</em> l&apos;agenzia può in ogni momento <strong>aggiornare l&apos;IBAN</strong> o <strong>richiedere un nuovo tentativo di addebito</strong> dall&apos;apposita sezione. <em>Revoca:</em> <strong>automatica</strong>, non appena non risultino più addebiti insoluti o in corso. Non è discrezionale.
          </p>
          <p>
            <strong>11.2 &mdash; Sospensione automatica per mancate risposte reiterate (solo agenzie).</strong> <em>Presupposto:</em> <strong>5 assegnazioni consecutive lasciate scadere senza alcuna risposta</strong> (né accettazione né rifiuto). <em>Effetto:</em> è sospesa la <strong>singola sede</strong> interessata, esclusa dalla distribuzione. <strong>Le altre sedi restano attive e gli utenti non sono disabilitati.</strong> <em>Misura anti-elusione:</em> finché la sospensione della sede ai sensi del presente punto è in essere, l&apos;Utente <strong>non può aprire nuove sedi</strong> per aggirarla. <em>Precisazione:</em> il <strong>rifiuto espresso</strong> di una pratica <strong>non concorre</strong> a questa soglia &mdash; incide solo sull&apos;ordinamento in distribuzione. Rileva <strong>unicamente la mancata risposta</strong>. <em>Revoca:</em> la sospensione disposta dal sistema anti-abuso è revocata <strong>da Passaggio Veloce</strong>, su richiesta dell&apos;Utente e previa verifica. Resta ferma e impregiudicata la facoltà dell&apos;Utente di <strong>sospendere e riattivare autonomamente</strong> le proprie sedi per esigenze organizzative: tale facoltà <strong>non consente</strong> di revocare la sospensione disposta ai sensi del presente punto.
          </p>
          <p>
            <strong>11.3 &mdash; Sospensione dell&apos;account.</strong> <em>Effetto:</em> l&apos;accesso alla Piattaforma è inibito per l&apos;azienda e per tutte le sue utenze. La misura è <strong>reversibile</strong>. <em>Motivi tassativi</em> &mdash; la sospensione può essere disposta <strong>esclusivamente</strong> per uno dei seguenti motivi:
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              <strong>frode o tentativo di frode</strong> ai danni di Passaggio Veloce, di altri Utenti o di terzi;
            </li>
            <li>
              <strong>falsità o alterazione</strong> di dati aziendali, documenti d&apos;identità, documenti del veicolo o della pratica;
            </li>
            <li>
              <strong>abuso del programma di affiliazione</strong>: iscrizioni fittizie, account multipli riconducibili al medesimo soggetto, collusione tra referente e referito, o altre condotte volte a generare commissioni non corrispondenti a pratiche reali;
            </li>
            <li>
              <strong>raggiungimento di 2 penali confermate</strong> ai sensi della clausola 10;
            </li>
            <li>
              <strong>mancata regolarizzazione</strong> della limitazione di cui al punto 11.1 nonostante i solleciti;
            </li>
            <li>
              <strong>violazione grave o reiterata</strong> dei presenti Termini;
            </li>
            <li>
              <strong>uso della Piattaforma per finalità illecite</strong> o in violazione di legge;
            </li>
            <li>
              <strong>richiesta dell&apos;Autorità</strong> giudiziaria o amministrativa, o obbligo di legge;
            </li>
            <li>
              <strong>venir meno dei requisiti soggettivi</strong>: cessazione della partita IVA, cancellazione dal Registro delle Imprese, cessazione dell&apos;attività d&apos;impresa;
            </li>
            <li>
              <strong>condotta gravemente lesiva</strong> verso altri Utenti o il personale di Passaggio Veloce.
            </li>
          </ol>
          <p>
            <em>Comunicazione e riesame:</em> la sospensione è <strong>comunicata via email con indicazione del motivo</strong>. L&apos;Utente può presentare osservazioni e chiedere il <strong>riesame</strong> scrivendo ad{' '}
            <a
              href="mailto:assistenza@passaggioveloce.it"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              assistenza@passaggioveloce.it
            </a>
            ; Passaggio Veloce riscontra entro <strong>15 giorni</strong>. Venuto meno il motivo, l&apos;account è riattivato.
          </p>
          <p>
            <em>Effetti economici:</em> <strong>la sospensione non comporta in alcun caso la perdita dei compensi già maturati</strong>, che restano accreditati sul wallet e sono liquidati ai sensi della clausola 5.
          </p>
          <p>
            <strong>11.3-bis &mdash; Sospensione della singola utenza.</strong> Oltre alla sospensione dell&apos;intero account di cui al punto 11.3, Passaggio Veloce può sospendere una <strong>singola utenza</strong> associata all&apos;Utente (un dipendente o collaboratore autorizzato ad accedere alla Piattaforma), per uno dei <strong>motivi tassativi elencati al punto 11.3</strong>, quando la condotta contestata sia riferibile a quella specifica persona e non renda necessaria la sospensione dell&apos;intero account. <em>Effetto:</em> l&apos;utenza interessata <strong>non può più accedere</strong> alla Piattaforma; <strong>l&apos;account aziendale e le altre utenze dell&apos;Utente restano pienamente operativi</strong>. <em>Comunicazione e riesame:</em> la sospensione è <strong>comunicata via email all&apos;utenza interessata, con indicazione del motivo</strong>; l&apos;Utente (tramite il proprio account amministratore) e la persona interessata possono chiedere il <strong>riesame</strong> con le stesse modalità del punto 11.3. <em>Effetti economici:</em> restano fermi quelli del punto 11.3 &mdash; <strong>nessuna perdita dei compensi già maturati</strong>.
          </p>
          <p>
            <strong>11.4 &mdash; Cancellazione dell&apos;account.</strong> <em>Su richiesta dell&apos;Utente:</em> scrivendo ad{' '}
            <a
              href="mailto:assistenza@passaggioveloce.it"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              assistenza@passaggioveloce.it
            </a>
            . <em>Su iniziativa di Passaggio Veloce:</em> <strong>solo</strong> nelle ipotesi di cui al punto 11.3 di <strong>particolare gravità</strong> (frode accertata, falsità documentale, illecito, ordine dell&apos;Autorità) <strong>oppure</strong> in caso di perdurante sospensione senza regolarizzazione. <em>Effetti:</em> disattivazione dell&apos;account e cancellazione dei dati secondo l&apos;Informativa Privacy, fatti salvi gli obblighi di conservazione di legge (in particolare fiscali e contabili) e le esigenze di audit sulle pratiche già eseguite. <em>Effetti economici:</em> restano dovuti gli importi maturati fino alla cessazione; <strong>il saldo residuo del wallet è liquidato integralmente all&apos;Utente, anche se inferiore a 500 €</strong>, previa emissione dei documenti fiscali e regolarizzazione di quanto eventualmente dovuto a Passaggio Veloce.
          </p>
          <p>
            <strong>11.5 &mdash; Tassatività.</strong> Al di fuori delle ipotesi elencate nella presente clausola, Passaggio Veloce <strong>non adotta alcuna misura limitativa, sospensiva o interruttiva</strong> dell&apos;account o delle singole utenze. Restano ferme le <strong>misure tecniche di sicurezza</strong> a protezione dell&apos;account, quali il blocco temporaneo dell&apos;accesso dopo ripetuti tentativi di login falliti: non hanno natura sanzionatoria e non costituiscono una misura ai sensi della presente clausola. <strong>In nessun caso</strong> la limitazione, la sospensione (dell&apos;account o della singola utenza) o la cancellazione comportano <strong>la perdita dei compensi già maturati</strong> dall&apos;Utente. L&apos;Utente accetta espressamente le misure di limitazione operativa, sospensione dell&apos;account, sospensione della singola utenza e cancellazione dell&apos;account disciplinate dalla presente clausola (clausola vessatoria: v. clausola 17).
          </p>
        </Section>

        <Section title="12. Limitazioni di responsabilità">
          <p>
            Passaggio Veloce risponde esclusivamente del corretto funzionamento tecnologico della
            Piattaforma e della corretta esecuzione delle transazioni economiche tracciate. Nei
            limiti consentiti dalla legge, Passaggio Veloce{' '}
            <strong>non è responsabile</strong> di errori, omissioni o falsità nei dati e documenti
            caricati dall&apos;Utente, dell&apos;operato e dei ritardi delle agenzie
            nell&apos;esecuzione delle pratiche, né di danni indiretti o consequenziali. In ogni
            caso, ove una responsabilità fosse accertata, essa è limitata all&apos;importo delle fee
            corrisposte dall&apos;Utente a Passaggio Veloce nei dodici mesi precedenti l&apos;evento.
            L&apos;Utente accetta espressamente la presente limitazione (clausola vessatoria: v.
            clausola 17).
          </p>
        </Section>

        <Section title="13. Modifiche ai Termini">
          <p>
            Passaggio Veloce può modificare i presenti Termini con <strong>preavviso di 30
            giorni</strong> notificato via email. Per le modifiche sostanziali (in particolare
            ambito del servizio e struttura dei corrispettivi diversa dalla variazione di cui alla
            clausola 3) sarà richiesta la <strong>riaccettazione esplicita</strong>. La prosecuzione
            nell&apos;uso della Piattaforma dopo l&apos;efficacia delle modifiche non sostanziali ne
            comporta l&apos;accettazione.
          </p>
        </Section>

        <Section title="14. Durata e recesso">
          <p>
            Il rapporto è a <strong>tempo indeterminato</strong>. Ciascuna parte può recedere
            liberamente in qualsiasi momento con <strong>preavviso di 30 giorni</strong> comunicato
            via email. Il recesso non pregiudica le obbligazioni economiche già maturate né i
            documenti fiscali già emessi.
          </p>
        </Section>

        <Section title="15. Trattamento dei dati personali">
          <p>
            Il trattamento dei dati personali è disciplinato dall&apos;
            <Link href="/privacy" className="font-semibold text-pv-navy-700 hover:underline">
              Informativa Privacy
            </Link>
            , conforme al Regolamento (UE) 2016/679 (GDPR), che l&apos;Utente dichiara di aver preso
            visione.
          </p>
        </Section>

        <Section title="16. Legge applicabile e foro competente">
          <p>
            I presenti Termini sono regolati dalla <strong>legge italiana</strong>. Per ogni
            controversia relativa alla loro interpretazione ed esecuzione è competente in via
            esclusiva il foro del luogo in cui ha sede legale Passaggio Veloce S.r.l. L&apos;Utente
            accetta espressamente tale deroga alla competenza territoriale (clausola vessatoria: v.
            clausola 17).
          </p>
        </Section>

        <Section title="17. Approvazione specifica delle clausole (artt. 1341 e 1342 c.c.)">
          <p>
            Ai sensi e per gli effetti degli <strong>artt. 1341 e 1342 c.c.</strong>, l&apos;Utente
            dichiara di aver letto e di <strong>approvare specificamente</strong> le seguenti
            clausole:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>3</strong> (Prezzo del servizio e facoltà di variazione a discrezione, senza
              limitazioni);
            </li>
            <li>
              <strong>5</strong> (Wallet e condizioni di prelievo, inclusa la soglia di 500 € per
              la richiesta di payout &mdash; senza decadenza del credito al di sotto di essa
              &mdash; e la sospensione dei payout su tutti i wallet in caso di saldo negativo
              anche di uno solo di essi);
            </li>
            <li>
              <strong>7</strong> (Regime fiscale e determinazione differenziata del compenso, incluse
              le trattenute per i soggetti forfettari);
            </li>
            <li>
              <strong>8</strong> (Responsabilità sull&apos;aggiornamento della visura e manleva a
              favore di Passaggio Veloce);
            </li>
            <li>
              <strong>10</strong> (Sistema di segnalazioni e penali);
            </li>
            <li>
              <strong>11</strong> (Limitazione operativa, sospensione e cancellazione
              dell&apos;account);
            </li>
            <li>
              <strong>12</strong> (Limitazioni di responsabilità);
            </li>
            <li>
              <strong>16</strong> (Legge applicabile e foro competente).
            </li>
          </ul>
          <p className="mt-3">
            L&apos;approvazione specifica delle predette clausole è raccolta, in fase di
            registrazione, mediante apposita e distinta accettazione, in aggiunta all&apos;accettazione
            generale dei presenti Termini.
          </p>
        </Section>

        <p className="mt-8 text-[11px] text-pv-slate-500">
          Documento in versione tecnica completa, soggetto a revisione legale prima
          dell&apos;entrata in vigore definitiva. Eventuali aggiornamenti saranno comunicati via
          email agli Utenti registrati con il preavviso di cui alla clausola 13.
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
