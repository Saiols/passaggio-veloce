import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { JsonLd } from '@/lib/seo/JsonLdScript';
import { webPageJsonLd } from '@/lib/seo/jsonLd';
import { siteUrl } from '@/lib/seo/brand';
import {
  ART_APPROVAZIONE_SPECIFICA,
  ART_DATI_TERZI,
  CLAUSOLE_VESSATORIE,
  DESCRIZIONI_VESSATORIE,
} from '@/lib/legal/clausole-vessatorie';

export const metadata: Metadata = {
  title: 'Termini e Condizioni',
  description:
    'Termini e Condizioni di utilizzo della piattaforma Passaggio Veloce: prezzo del servizio, affiliazione, wallet e payout, fatturazione conto terzi, regime fiscale, responsabilità, proprietà intellettuale, riservatezza, foro competente.',
  alternates: { canonical: '/termini' },
  robots: { index: true, follow: true },
};

/**
 * Termini e Condizioni di utilizzo (contratto B2B). Draft tecnico completo:
 * DA SOTTOPORRE A REVISIONE LEGALE prima dell'entrata in vigore definitiva, in
 * particolare le manleve (8, 23) e le limitazioni di responsabilità (13). Le
 * clausole vessatorie ex artt. 1341-1342 c.c. sono elencate alla clausola
 * {ART_APPROVAZIONE_SPECIFICA} e richiedono la seconda accettazione specifica
 * raccolta in fase di registrazione.
 *
 * Revisione 2026-07-11: riscritte le clausole 5 (prelievo — un wallet per
 * sede + wallet madre affiliazione, soglia di accumulo per wallet, nessuna
 * decadenza, liquidazione del residuo alla cessazione), 10 (penali —
 * esaustiva e tassativa) e 12 (limitazione / sospensione / cancellazione —
 * quattro misure distinte, motivi tassativi, incl. 12.3-bis sospensione
 * della singola utenza). Spec:
 * docs/superpowers/specs/2026-07-11-termini-penali-sospensione-design.md
 *
 * Revisione 2026-07-14: nuova clausola sui dati di venditori e acquirenti —
 * PV titolare autonomo, garanzia + manleva dell'Utente. Spec:
 * docs/superpowers/specs/2026-07-14-gdpr-dati-terzi-design.md
 *
 * Revisione 2026-07-17: ciclo di vita della visura camerale nelle clausole
 * ESISTENTI. Clausola 8: validità 180 giorni, obbligo di aggiornamento e
 * preavviso email a 5 giorni. Clausola 5: sospensione del prelievo (Broker e
 * Agenzia) per visura non aggiornata. Clausola 12: nuovo sotto-punto 12.1-bis,
 * limitazione operativa della sola Agenzia. Spec: .superpowers/sdd/task-6.1-brief.md
 *
 * Revisione 2026-07-26 — merge del documento «PassaggioVeloce Termini COMPLETO
 * FINALE» (v8). Quattro clausole NUOVE inserite in mezzo al testo (14 forza
 * maggiore, 15 proprietà intellettuale, 16 riservatezza + divieto di elusione,
 * 17 divieto di cessione; poi 20 integrità del contratto e 21 comunicazioni
 * ufficiali): il documento le colloca lì e questo ha comportato una
 * RINUMERAZIONE (modifiche 14→18, recesso 15→19, privacy 16→22, dati terzi
 * 17→23, foro 18→24, approvazione specifica 19→25). Per questo i numeri citati
 * fuori da questa pagina si leggono SEMPRE da lib/legal/clausole-vessatorie.ts
 * (`ART_DATI_TERZI`, `ART_APPROVAZIONE_SPECIFICA`) e mai a mano — v. il commento
 * di quel file. Modifiche sostanziali di merito: clausola 3 (la variazione di
 * prezzo non è più discrezionale, ma soggetta a preavviso 7/30 giorni con
 * recesso senza penali), clausola 5 e 10.6 (il saldo negativo di un wallet NON
 * blocca più gli altri wallet dell'Utente), clausola 4 (split 50/50 della
 * commissione di affiliazione), clausola 6 (conferma OTP del mandato al primo
 * payout, ora vessatoria), clausola 10.3 (esito della verifica entro 10 giorni
 * lavorativi), clausola 13 (cap del danno differenziato per dolo/colpa grave +
 * continuità del servizio as-is).
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
        <p className="mt-2 text-[12px] text-pv-slate-500">Ultimo aggiornamento: 2026-07-26</p>

        <p className="mt-4">
          I presenti Termini e Condizioni (i &laquo;<strong>Termini</strong>&raquo;) disciplinano
          l&apos;utilizzo della piattaforma <strong>Passaggio Veloce</strong>{' '}(la
          &laquo;Piattaforma&raquo;), gestita da <strong>Passaggio Veloce S.r.l.</strong>{' '}
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
            contatto <strong>broker</strong>{' '}(dealer/concessionarie auto) con{' '}
            <strong>agenzie</strong>{' '}di pratiche automobilistiche per la gestione di passaggi di
            proprietà, minivolture e servizi correlati, fornendo strumenti di distribuzione delle
            pratiche, tracciamento, gestione dei compensi e fatturazione.
          </p>
          <p>
            Passaggio Veloce <strong>non è parte</strong>{' '}del contratto di esecuzione della pratica
            automobilistica, che resta tra il broker e l&apos;agenzia assegnata. Passaggio Veloce
            non presta consulenza automobilistica, fiscale o legale e non risponde dell&apos;esito
            della singola pratica.
          </p>
        </Section>

        <Section title="2. Registrazione, account e verifica (KYC)">
          <p>
            Per utilizzare la Piattaforma l&apos;Utente si registra fornendo dati aziendali
            veritieri, completi e aggiornati (ragione sociale, partita IVA, sede legale e sedi
            operative, regime fiscale, contatti, IBAN) e i documenti richiesti per la verifica
            antifrode e di identità (KYC), tra cui documento d&apos;identità del legale
            rappresentante, codice fiscale e visura camerale.
          </p>
          <p>
            La registrazione genera un unico account amministratore titolare, cui l&apos;Utente può
            associare ulteriori utenze e sedi operative. L&apos;Utente è responsabile della
            riservatezza delle credenziali, dell&apos;operato delle utenze da esso create e della
            veridicità di ogni dato e documento caricato, anche relativo alle pratiche.
          </p>
          <p>
            L&apos;Utente che assegna l&apos;accesso alla Piattaforma a dipendenti, collaboratori o altri soggetti (<strong>sub-utenti</strong>) è tenuto a <strong>informarli preventivamente</strong>{' '}del trattamento dei loro dati personali da parte di Passaggio Veloce per le finalità indicate nell&apos;<Link href="/privacy" className="font-semibold text-pv-navy-700 hover:underline">Informativa Privacy</Link>, <strong>prima</strong>{' '}di procedere alla creazione delle relative utenze. L&apos;Utente è responsabile dell&apos;adempimento di tale obbligo informativo e manleva Passaggio Veloce da qualsiasi pretesa dei sub-utenti derivante dalla mancata informativa.
          </p>
        </Section>

        <Section title="3. Prezzo del servizio (fee a carico dell'agenzia)">
          <p>
            A fronte del servizio di intermediazione, per <strong>ogni pratica accettata</strong>{' '}
            dall&apos;agenzia e ricevuta tramite la Piattaforma è dovuto a Passaggio Veloce un
            corrispettivo <strong>variabile compreso tra 1 € e 200 €</strong>{' '}per pratica. Il
            corrispettivo applicabile è indicato in Piattaforma al momento dell&apos;invio/accettazione
            della pratica. Il valore di <strong>200 €</strong>{' '}costituisce il <strong>tetto massimo invalicabile</strong>{' '}del corrispettivo per singola pratica.
          </p>
          <p>
            Passaggio Veloce si riserva il diritto di variare il prezzo del servizio, <strong>entro il predetto intervallo</strong>, in relazione alla tipologia di pratica, alla zona e alle condizioni di mercato, secondo le seguenti modalità:
          </p>
          <ol className="mt-2 list-[lower-alpha] space-y-1 pl-5">
            <li>
              <strong>Variazioni fino al 20% della tariffa corrente</strong>: comunicate con <strong>preavviso minimo di 7 (sette) giorni</strong>{' '}via email. La variazione entra in vigore dalla prima pratica inviata o accettata successivamente alla data di efficacia indicata nella comunicazione.
            </li>
            <li>
              <strong>Variazioni superiori al 20% della tariffa corrente</strong>{' '}o modifiche strutturali alle tipologie di corrispettivo: comunicate con <strong>preavviso minimo di 30 (trenta) giorni</strong>{' '}via email, con <strong>riaccettazione esplicita</strong>{' '}da parte dell&apos;Utente prima dell&apos;entrata in vigore.
            </li>
          </ol>
          <p>
            In entrambi i casi, durante il periodo di preavviso l&apos;Utente che non intenda accettare la variazione può <strong>recedere dal contratto senza penali</strong>, con effetto dalla data di entrata in vigore della variazione stessa, comunicando il recesso via email ad{' '}
            <a
              href="mailto:assistenza@passaggioveloce.it"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              assistenza@passaggioveloce.it
            </a>
            . Le pratiche già in corso al momento del recesso sono gestite alle condizioni precedenti. L&apos;agenzia accetta espressamente tale facoltà di variazione (clausola vessatoria: v. clausola {ART_APPROVAZIONE_SPECIFICA}).
          </p>
        </Section>

        <Section title="4. Programma di affiliazione">
          <p>
            L&apos;Utente può invitare altri operatori tramite un proprio link di affiliazione. Per
            ogni pratica generata da un utente registrato tramite tale link è riconosciuta una
            commissione di affiliazione <strong>compresa tra 1 € e 10 €</strong>{' '}per pratica,
            dovuta <strong>unicamente ed esclusivamente a pratica firmata</strong>{' '}(non alla sola
            accettazione o invio).
          </p>
          <p>
            Qualora a una medesima pratica siano collegati <strong>due</strong>{' '}soggetti affiliati &mdash; ossia sia il broker sia l&apos;agenzia risultino iscritti tramite referral &mdash; la commissione di affiliazione è <strong>ripartita in parti uguali tra i due referenti (50% ciascuno)</strong>, salvo diversa indicazione pubblicata nella sezione Affiliazione della Piattaforma, che costituisce parte integrante dei presenti Termini. In presenza di un solo referente, la commissione è a questi integralmente riconosciuta.
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
            L&apos;Utente dispone di <strong>portafogli distinti</strong>: <strong>un wallet per ciascuna sede operativa</strong>, sul quale confluiscono i compensi delle pratiche lavorate da quella sede (ed eventuali bonus promozionali), e — ove applicabile — <strong>un unico wallet aziendale</strong> per le <strong>commissioni di affiliazione</strong> (clausola 4). Un Utente con più sedi dispone pertanto di più wallet di sede, <strong>ciascuno con contabilità separata</strong> quanto agli accrediti, alla soglia di accumulo per la richiesta di prelievo e agli effetti di un eventuale saldo negativo. I compensi <strong>si accumulano liberamente</strong> su ciascun wallet. La <strong>richiesta di prelievo</strong> può essere presentata, <strong>per ciascun wallet separatamente</strong>, una volta raggiunto su di esso un saldo di <strong>500 €</strong>; al di sotto di tale importo i compensi <strong>restano accreditati e continuano ad accumularsi senza alcuna perdita</strong>. Al raggiungimento della soglia di payout automatico configurata dall&apos;Utente (di regola 1.000 €, impostabile tra 1.000 € e 5.000 €) l&apos;erogazione è avviata automaticamente, wallet per wallet. L&apos;erogazione avviene mediante bonifico sull&apos;IBAN indicato.
          </p>
          <p>
            <strong>Bonus promozionali e crediti omaggio.</strong>{' '}Eventuali bonus promozionali di iscrizione o crediti omaggio accreditati da Passaggio Veloce sul wallet dell&apos;Utente <strong>non sono prelevabili autonomamente</strong> e <strong>non abbassano la soglia minima di payout</strong>. Il prelievo del saldo del wallet — inclusa la quota corrispondente al bonus — è possibile unicamente al raggiungimento della <strong>soglia minima di 500 € calcolata sul totale del wallet</strong>. Fino a tale soglia, il bonus resta accreditato e si cumula con i compensi maturati dalle pratiche.
          </p>
          <p>
            <strong>Addebito di penali e saldo del wallet.</strong>{' '}In caso di applicazione di una penale ai sensi della clausola 10.4, l&apos;importo è addebitato sul <strong>wallet della sede interessata</strong>. Qualora l&apos;addebito determini un <strong>saldo negativo</strong> su quel wallet, i compensi delle pratiche successive si accreditano naturalmente compensando il negativo fino al ripristino di un saldo positivo. Il prelievo <strong>dal wallet interessato</strong> è possibile solo al raggiungimento della soglia di 500 € con saldo positivo. <strong>Gli altri wallet dell&apos;Utente</strong> (altre sedi e wallet di affiliazione) <strong>non sono in alcun modo vincolati o bloccati</strong> per effetto del saldo negativo di un singolo wallet. <strong>L&apos;operatività dell&apos;Utente nella gestione delle pratiche resta invariata.</strong>
          </p>
          <p>
            <strong>In ogni caso di cessazione del rapporto</strong> (recesso di una delle parti, chiusura o cancellazione dell&apos;account) <strong>il saldo residuo positivo di ciascun wallet è liquidato integralmente all&apos;Utente anche se inferiore a 500 €</strong>, previa emissione dei documenti fiscali e regolarizzazione di quanto eventualmente dovuto a Passaggio Veloce. Qualora un wallet dell&apos;Utente presenti saldo negativo, <strong>la liquidazione è sospesa fino alla regolarizzazione del debito</strong>.
          </p>
          <p>
            <strong>Sospensione del prelievo per visura camerale non aggiornata.</strong>{' '}Il prelievo del saldo dei wallet dell&apos;Utente &mdash; di ciascuna sede e, ove presente, del wallet aziendale di affiliazione &mdash; è <strong>altresì sospeso</strong> qualora la visura camerale dell&apos;Utente risulti <strong>emessa da oltre 180 giorni</strong> (clausola 8), e ciò fino al caricamento di una visura aggiornata nell&apos;apposita sezione della Piattaforma. La sospensione <strong>non incide sulla maturazione né sulla titolarità delle somme</strong>, che restano integralmente acquisite all&apos;Utente, ma ne differisce la sola erogazione: lo <strong>sblocco è automatico e immediato</strong> al momento dell&apos;accettazione del documento aggiornato, senza necessità di alcun intervento manuale. La misura si applica <strong>sia all&apos;Utente Broker sia all&apos;Utente Agenzia</strong>.
          </p>
          <p>
            L&apos;Utente accetta espressamente le presenti condizioni di prelievo, inclusa la soglia di richiesta del payout, le condizioni sui bonus promozionali e la sospensione del prelievo per visura camerale non aggiornata (clausola vessatoria: v. clausola {ART_APPROVAZIONE_SPECIFICA}).
          </p>
        </Section>

        <Section title="6. Fatturazione per conto terzi (fatturazione delegata)">
          <p>
            L&apos;Utente <strong>conferisce mandato a Passaggio Veloce</strong>{' '}a emettere, in nome
            e/o per conto dell&apos;Utente stesso, i documenti fiscali relativi ai compensi maturati
            sulla Piattaforma (<strong>fatturazione per conto terzi</strong>), nonché a gestire la
            relativa numerazione e trasmissione tramite Sistema di Interscambio (SDI) secondo la
            normativa italiana sulla fatturazione elettronica B2B.
          </p>
          <p>
            Il mandato alla fatturazione delegata, accettato in fase di registrazione unitamente ai presenti Termini, è <strong>confermato con apposita procedura OTP</strong> (One Time Password) <strong>al momento del primo prelievo (payout)</strong> da parte dell&apos;Utente. Tale conferma — registrata con <strong>timestamp e indirizzo IP</strong>{' '}— costituisce accettazione espressa e tracciabile del mandato e delle relative condizioni.
          </p>
          <p>
            Nell&apos;esercizio del mandato, Passaggio Veloce provvede all&apos;emissione dei documenti fiscali <strong>in nome e per conto dell&apos;Utente</strong>, riportando i dati fiscali dell&apos;Utente come <strong>soggetto cedente/prestatore</strong>, nel rispetto della normativa vigente in materia di fatturazione elettronica e delle modalità tecniche di trasmissione allo SDI di volta in volta adottate da Passaggio Veloce.
          </p>
          <p>
            L&apos;Utente si obbliga a fornire e mantenere aggiornati tutti i dati necessari alla corretta emissione dei documenti fiscali e riconosce come validamente emessi i documenti generati da Passaggio Veloce nell&apos;esercizio di tale mandato. Passaggio Veloce <strong>non è responsabile</strong>{' '}di errori derivanti da dati fiscali errati o non aggiornati forniti dall&apos;Utente. L&apos;Utente accetta espressamente il presente mandato e la relativa conferma OTP (clausola vessatoria: v. clausola {ART_APPROVAZIONE_SPECIFICA}).
          </p>
        </Section>

        <Section title="7. Regime fiscale e determinazione differenziata del compenso">
          <p>
            Il trattamento economico e fiscale dei compensi varia in funzione del{' '}
            <strong>regime fiscale</strong>{' '}dichiarato dall&apos;Utente (a titolo esemplificativo:
            società/azienda, ditta individuale in regime ordinario, ditta individuale in regime
            forfettario). L&apos;Utente è tenuto a dichiarare il proprio regime in modo veritiero e a
            comunicarne tempestivamente le variazioni.
          </p>
          <p>
            In particolare, per gli Utenti in <strong>regime forfettario</strong>, non applicando questi l&apos;IVA, Passaggio Veloce <strong>tratterrà la differenza corrispondente all&apos;IVA</strong>{' '}e l&apos;importo erogato all&apos;Utente sarà conseguentemente <strong>inferiore</strong>{' '}rispetto a quello riconosciuto ai soggetti che applicano l&apos;IVA. Tale meccanismo è <strong>comunicato esplicitamente in fase di registrazione</strong>, prima dell&apos;accettazione dei presenti Termini. L&apos;Utente accetta espressamente tale meccanismo di determinazione differenziata del compenso (clausola vessatoria: v. clausola {ART_APPROVAZIONE_SPECIFICA}).
          </p>
        </Section>

        <Section title="8. Visura camerale: aggiornamento, responsabilità e manleva">
          <p>
            L&apos;Utente è <strong>responsabile del costante aggiornamento</strong>{' '}della propria
            visura camerale e degli altri dati anagrafici e fiscali sulla Piattaforma. Passaggio
            Veloce si basa sui dati e documenti forniti dall&apos;Utente per la gestione dei compensi
            e della fatturazione.
          </p>
          <p>
            <strong>Validità e aggiornamento della visura camerale.</strong>{' '}L&apos;Utente garantisce che la visura camerale fornita sia autentica e riferita alla propria impresa. La visura ha una <strong>validità di 180 (centottanta) giorni</strong> dalla data di emissione risultante dal Registro delle Imprese. Decorso tale termine, l&apos;Utente è tenuto a caricare, nell&apos;<strong>apposita sezione della Piattaforma</strong>, una visura aggiornata, <strong>emessa da non più di 180 giorni</strong>. L&apos;aggiornamento è necessario a consentire a Passaggio Veloce la corretta emissione dei documenti fiscali per conto e nei confronti dell&apos;Utente (clausola 6). Passaggio Veloce comunica all&apos;Utente l&apos;approssimarsi della scadenza nei <strong>5 (cinque) giorni</strong> precedenti, all&apos;indirizzo email indicato in registrazione. <strong>Il mancato aggiornamento entro il predetto termine comporta le conseguenze di cui alle clausole 5 e 12</strong>: la sospensione del prelievo dei wallet per ogni Utente (clausola 5) e, per il solo Utente Agenzia, la limitazione dell&apos;operatività con esclusione dalla distribuzione delle pratiche (clausola 12); entrambe cessano automaticamente al caricamento di una visura aggiornata.
          </p>
          <p>
            L&apos;Utente <strong>manleva e tiene indenne Passaggio Veloce</strong>{' '}da ogni pretesa,
            danno, sanzione o onere derivante da dati o documenti non veritieri, incompleti o non
            aggiornati (inclusa la visura), affinché sia garantita una gestione corretta della
            fatturazione, anche nell&apos;ambito della fatturazione per conto terzi di cui alla
            clausola 6. L&apos;Utente accetta espressamente la presente manleva (clausola vessatoria:
            v. clausola {ART_APPROVAZIONE_SPECIFICA}).
          </p>
        </Section>

        <Section title="9. Mandato di addebito diretto SEPA (agenzie)">
          <p>
            Le agenzie autorizzano Passaggio Veloce ad addebitare il proprio conto mediante addebito
            diretto SEPA (SEPA Direct Debit) per gli importi delle fee dovute ai sensi della clausola
            3, secondo le tempistiche indicate in Piattaforma. L&apos;addebito è disposto alla
            registrazione della firma; l&apos;incasso segue i tempi dello standard SDD e la fattura è
            emessa ad avvenuto incasso. Il mandato è revocabile secondo lo standard SDD; la revoca
            non fa venir meno gli importi già maturati.
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
            <strong>10.1 &mdash; Verifica preventiva a carico del broker.</strong> Passaggio Veloce <strong>non effettua visure PRA</strong>. Prima dell&apos;invio di ogni pratica il broker verifica personalmente, <strong>per ciascun veicolo</strong>, che: (a) non sussistano fermi amministrativi; (b) non sussistano ipoteche o vincoli iscritti al PRA; (c) i documenti caricati siano autentici e corrispondenti al veicolo. Tale verifica forma oggetto di <strong>dichiarazione espressa</strong>{' '}resa in Piattaforma prima di ogni invio, registrata con data, ora e versione del testo accettato.
          </p>
          <p>
            <strong>10.2 &mdash; Segnalazione dell&apos;agenzia.</strong> La sola <strong>agenzia assegnataria</strong> può segnalare, <strong>esclusivamente prima della firma</strong> (pratica in stato &laquo;Accettata&raquo; o &laquo;Processata&raquo;): <strong>fermo amministrativo</strong>, <strong>ipoteca o vincolo PRA</strong>, <strong>documento non valido</strong>, <strong>altro</strong> (con nota). L&apos;agenzia <strong>indica i veicoli interessati</strong>. Dopo la firma la pratica è chiusa e non è più segnalabile.
          </p>
          <p>
            <strong>10.3 &mdash; Verifica di Passaggio Veloce e termini. Nessuna penale è mai applicata automaticamente.</strong> Ogni segnalazione è verificata da Passaggio Veloce, che può <strong>confermarla</strong> (pratica annullata, penale addebitata) o <strong>respingerla</strong>{' '}(pratica prosegue, nessun addebito). Passaggio Veloce comunica l&apos;esito <strong>entro 10 (dieci) giorni lavorativi</strong> dalla ricezione della segnalazione. Qualora la verifica richiedesse tempi più lunghi per motivi documentati, Passaggio Veloce ne dà comunicazione all&apos;Utente entro il medesimo termine, indicando la data prevista di conclusione. <strong>Il decorso del termine senza risposta non implica né accoglimento né rigetto automatico</strong>{' '}della segnalazione. L&apos;esito &mdash; conferma o rigetto &mdash; è comunicato via email a entrambe le parti.
          </p>
          <p>
            <strong>10.4 &mdash; Penale: unica penale prevista.</strong> In caso di segnalazione <strong>confermata</strong> è addebitata al broker una penale di <strong>€ 25,00 per ciascun veicolo oggetto della segnalazione confermata</strong>. La penale: (a) è addebitata sul <strong>wallet della sede del broker interessata</strong>; (b) <strong>non è soggetta a IVA</strong>, costituendo somma dovuta a titolo di penalità, esclusa dalla base imponibile ai sensi dell&apos;<strong>art. 15, co. 1, n. 1, D.P.R. 633/1972</strong>; (c) <strong>non si applica ai veicoli non segnalati</strong>{' '}della medesima pratica.
          </p>
          <p className="italic">
            Esempio: pratica con 3 veicoli, di cui 1 con fermo confermato → penale € 25,00 (un solo veicolo), non € 75,00.
          </p>
          <p>
            <strong>10.5 &mdash; Effetti della conferma.</strong> (a) la pratica è <strong>annullata</strong>; (b) il compenso della pratica <strong>non è maturato</strong> dal broker, poiché matura solo alla firma (se già eccezionalmente accreditato, è stornato); (c) all&apos;agenzia segnalante <strong>non è addebitata alcuna fee</strong>.
          </p>
          <p>
            <strong>10.6 &mdash; Saldo negativo del wallet.</strong> L&apos;addebito può portare il wallet della sede interessata a saldo negativo. In tal caso, come previsto dalla clausola 5, i compensi delle pratiche successive si accreditano naturalmente compensando il negativo fino al ripristino di un saldo positivo, e il prelievo <strong>da quel wallet</strong> resta possibile solo al raggiungimento della soglia di 500 € con saldo positivo. <strong>Gli altri wallet dell&apos;Utente non sono in alcun modo vincolati.</strong>{' '}
            L&apos;<strong>operatività resta invariata</strong>: il broker può continuare a caricare e gestire pratiche.
          </p>
          <p>
            <strong>10.7 &mdash; Reiterazione.</strong> Al raggiungimento di <strong>2 penali confermate</strong>, la posizione del broker è sottoposta a valutazione ai fini della sospensione ai sensi della clausola 12.
          </p>
          <p>
            <strong>10.8 &mdash; Tassatività.</strong> La penale di cui al punto 10.4 è <strong>l&apos;unica penale</strong> applicata da Passaggio Veloce. Oltre ad essa e al corrispettivo di cui alla clausola 3, <strong>nessun altro importo è addebitato all&apos;Utente a titolo di penale, sanzione o costo</strong>. Restano salve le sole <strong>rettifiche contabili</strong>{' '}volte a correggere accrediti o addebiti erronei, prive di natura sanzionatoria e sempre motivate e tracciate nel wallet. L&apos;Utente accetta espressamente il presente sistema di segnalazioni e penali (clausola vessatoria: v. clausola {ART_APPROVAZIONE_SPECIFICA}).
          </p>
        </Section>

        <Section title="11. Attestazione della firma da parte del Gestore">
          <p>
            Completata la lavorazione da parte dell&apos;Agenzia, la pratica resta in attesa che
            venga segnalata sulla Piattaforma l&apos;avvenuta sottoscrizione da parte del cliente.
            Il Gestore monitora le pratiche in attesa e può sollecitare Broker e Agenzia affinché
            vi provvedano.
          </p>
          <p>
            Qualora il Gestore acquisisca, per qualunque via (dichiarazione dell&apos;Agenzia o del
            Broker, documentazione ricevuta, riscontro presso gli uffici competenti), la conoscenza
            che la sottoscrizione è già intervenuta,{' '}
            <strong>
              può attestarla direttamente sulla Piattaforma in luogo dell&apos;Agenzia
            </strong>
            .
          </p>
          <p>
            L&apos;attestazione produce <strong>tutti gli effetti della segnalazione ordinaria</strong>:
            perfezionamento della pratica, maturazione del compenso del Broker e addebito della fee a
            carico dell&apos;Agenzia. La fattura relativa è emessa ad avvenuto incasso dell&apos;addebito.
          </p>
          <p>
            Il Gestore registra internamente data, autore e motivazione dell&apos;attestazione, e ne
            dà evidenza a Broker e Agenzia comunicando loro che la firma è stata attestata dal
            Gestore e la relativa data. L&apos;Agenzia che ritenga l&apos;attestazione erronea può
            contestarla, con comunicazione motivata all&apos;indirizzo di assistenza,{' '}
            <strong>entro 15 giorni</strong>{' '}dalla comunicazione della stessa; in tale sede il
            Gestore rende nota la motivazione dell&apos;attestazione. In caso di contestazione
            fondata il Gestore procede allo storno dell&apos;addebito e all&apos;emissione di nota di
            credito.
          </p>
          <p>
            L&apos;Utente approva espressamente il presente potere di attestazione (clausola
            vessatoria: v. clausola {ART_APPROVAZIONE_SPECIFICA}).
          </p>
        </Section>

        <Section title="12. Limitazione operativa, sospensione e cancellazione dell'account">
          <p>
            Passaggio Veloce adotta <strong>quattro misure distinte</strong>, di gravità crescente, di seguito elencate <strong>in modo tassativo</strong>.
          </p>
          <p>
            <strong>12.1 &mdash; Limitazione operativa per mancato incasso della fee (solo agenzie).</strong> <em>Presupposto:</em> l&apos;addebito SEPA della fee (clausola 3) non va a buon fine. <em>Effetto:</em> l&apos;agenzia <strong>conserva l&apos;accesso alla Piattaforma</strong> &mdash; <strong>l&apos;account NON è sospeso</strong> &mdash; ma è esclusa dalla distribuzione di nuove pratiche e non può accettare, lavorare o portare a firma pratiche fino alla regolarizzazione. <em>Rimedio:</em> l&apos;agenzia può in ogni momento <strong>aggiornare l&apos;IBAN</strong> o <strong>richiedere un nuovo tentativo di addebito</strong> dall&apos;apposita sezione. <em>Revoca:</em> <strong>automatica</strong>, non appena non risultino più addebiti insoluti o in corso. Non è discrezionale.
          </p>
          <p>
            <strong>12.1-bis &mdash; Limitazione operativa per visura camerale non aggiornata (solo agenzie).</strong> <em>Presupposto:</em> la visura camerale dell&apos;Utente Agenzia risulta emessa da oltre 180 giorni (clausola 8). <em>Effetto:</em> l&apos;agenzia <strong>conserva l&apos;accesso alla Piattaforma</strong> &mdash; <strong>l&apos;account NON è sospeso</strong> &mdash; ma è <strong>esclusa dalla distribuzione</strong> di nuove pratiche e non può accettare, lavorare o portare a firma pratiche fino alla regolarizzazione; le pratiche eventualmente già assegnate <strong>restano assegnate e riprendono alla regolarizzazione</strong>. Resta inoltre sospeso il prelievo dei wallet ai sensi della clausola 5. <em>Rimedio:</em> l&apos;agenzia carica in ogni momento una <strong>visura aggiornata</strong> (emessa da non più di 180 giorni) dall&apos;apposita sezione della Piattaforma. <em>Revoca:</em> <strong>automatica</strong>, non appena risulti caricata una visura in corso di validità; non è discrezionale. La presente misura riguarda le <strong>sole Agenzie</strong>: per l&apos;Utente Broker il mancato aggiornamento comporta la <strong>sola sospensione del prelievo</strong>{' '}di cui alla clausola 5, senza alcuna limitazione dell&apos;operatività.
          </p>
          <p>
            <strong>12.2 &mdash; Sospensione automatica per mancate risposte reiterate (solo agenzie).</strong> <em>Presupposto:</em> <strong>5 assegnazioni consecutive lasciate scadere senza alcuna risposta</strong> (né accettazione né rifiuto). <em>Effetto:</em> è sospesa la <strong>singola sede</strong> interessata, esclusa dalla distribuzione. <strong>Le altre sedi restano attive e gli utenti non sono disabilitati.</strong> <em>Misura anti-elusione:</em> finché la sospensione della sede ai sensi del presente punto è in essere, l&apos;Utente <strong>non può aprire nuove sedi</strong> per aggirarla. <em>Precisazione:</em> il <strong>rifiuto espresso</strong> di una pratica <strong>non concorre</strong> a questa soglia &mdash; incide solo sull&apos;ordinamento in distribuzione. Rileva <strong>unicamente la mancata risposta</strong>. <em>Revoca:</em> la sospensione disposta dal sistema anti-abuso è revocata <strong>da Passaggio Veloce</strong>, su richiesta dell&apos;Utente e previa verifica. Resta ferma e impregiudicata la facoltà dell&apos;Utente di <strong>sospendere e riattivare autonomamente</strong> le proprie sedi per esigenze organizzative: tale facoltà <strong>non consente</strong>{' '}di revocare la sospensione disposta ai sensi del presente punto.
          </p>
          <p>
            <strong>12.3 &mdash; Sospensione dell&apos;account.</strong> <em>Effetto:</em> l&apos;accesso alla Piattaforma è inibito per l&apos;azienda e per tutte le sue utenze. La misura è <strong>reversibile</strong>. <em>Motivi tassativi</em> &mdash; la sospensione può essere disposta <strong>esclusivamente</strong>{' '}per uno dei seguenti motivi:
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              <strong>frode o tentativo di frode</strong>{' '}ai danni di Passaggio Veloce, di altri Utenti o di terzi;
            </li>
            <li>
              <strong>falsità o alterazione</strong>{' '}di dati aziendali, documenti d&apos;identità, documenti del veicolo o della pratica;
            </li>
            <li>
              <strong>abuso del programma di affiliazione</strong>: iscrizioni fittizie, account multipli riconducibili al medesimo soggetto, collusione tra referente e referito, o altre condotte volte a generare commissioni non corrispondenti a pratiche reali;
            </li>
            <li>
              <strong>raggiungimento di 2 penali confermate</strong>{' '}ai sensi della clausola 10;
            </li>
            <li>
              <strong>mancata regolarizzazione</strong>{' '}della limitazione di cui al punto 12.1 nonostante i solleciti;
            </li>
            <li>
              <strong>violazione grave o reiterata</strong>{' '}dei presenti Termini;
            </li>
            <li>
              <strong>uso della Piattaforma per finalità illecite</strong>{' '}o in violazione di legge;
            </li>
            <li>
              <strong>richiesta dell&apos;Autorità</strong>{' '}giudiziaria o amministrativa, o obbligo di legge;
            </li>
            <li>
              <strong>venir meno dei requisiti soggettivi</strong>: cessazione della partita IVA, cancellazione dal Registro delle Imprese, cessazione dell&apos;attività d&apos;impresa;
            </li>
            <li>
              <strong>condotta gravemente lesiva</strong>{' '}verso altri Utenti o il personale di Passaggio Veloce.
            </li>
          </ol>
          <p>
            <em>Comunicazione e riesame:</em> la sospensione è <strong>comunicata via email con indicazione del motivo</strong>. L&apos;Utente può presentare osservazioni e chiedere il <strong>riesame</strong>{' '}scrivendo ad{' '}
            <a
              href="mailto:assistenza@passaggioveloce.it"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              assistenza@passaggioveloce.it
            </a>
            ; Passaggio Veloce riscontra entro <strong>15 giorni</strong>. <strong>Il decorso del termine senza risposta non implica accoglimento del riesame</strong>; Passaggio Veloce può prorogare motivatamente il termine, comunicando la proroga e la nuova data prevista di risposta <strong>entro il termine originario di 15 giorni</strong>. Venuto meno il motivo, l&apos;account è riattivato.
          </p>
          <p>
            <em>Effetti economici:</em> <strong>la sospensione non comporta in alcun caso la perdita dei compensi già maturati</strong>, che restano accreditati sul wallet e sono liquidati ai sensi della clausola 5.
          </p>
          <p>
            <strong>12.3-bis &mdash; Sospensione della singola utenza.</strong> Oltre alla sospensione dell&apos;intero account di cui al punto 12.3, Passaggio Veloce può sospendere una <strong>singola utenza</strong> associata all&apos;Utente (un dipendente o collaboratore autorizzato ad accedere alla Piattaforma), per uno dei <strong>motivi tassativi elencati al punto 12.3</strong>, quando la condotta contestata sia riferibile a quella specifica persona e non renda necessaria la sospensione dell&apos;intero account. <em>Effetto:</em> l&apos;utenza interessata <strong>non può più accedere</strong> alla Piattaforma; <strong>l&apos;account aziendale e le altre utenze dell&apos;Utente restano pienamente operativi</strong>. <em>Comunicazione e riesame:</em> la sospensione è <strong>comunicata via email all&apos;utenza interessata, con indicazione del motivo</strong>; l&apos;Utente (tramite il proprio account amministratore) e la persona interessata possono chiedere il <strong>riesame</strong> con le stesse modalità del punto 12.3. <em>Effetti economici:</em> restano fermi quelli del punto 12.3 &mdash; <strong>nessuna perdita dei compensi già maturati</strong>.
          </p>
          <p>
            <strong>12.4 &mdash; Cancellazione dell&apos;account.</strong> <em>Su richiesta dell&apos;Utente:</em>{' '}scrivendo ad{' '}
            <a
              href="mailto:assistenza@passaggioveloce.it"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              assistenza@passaggioveloce.it
            </a>
            . <em>Su iniziativa di Passaggio Veloce:</em> <strong>solo</strong> nelle ipotesi di cui al punto 12.3 di <strong>particolare gravità</strong> (frode accertata, falsità documentale, illecito, ordine dell&apos;Autorità) <strong>oppure</strong> in caso di perdurante sospensione senza regolarizzazione. <em>Effetti:</em> disattivazione dell&apos;account e cancellazione dei dati secondo l&apos;Informativa Privacy, fatti salvi gli obblighi di conservazione di legge (in particolare fiscali e contabili) e le esigenze di audit sulle pratiche già eseguite. <em>Effetti economici:</em> restano dovuti gli importi maturati fino alla cessazione; <strong>il saldo residuo del wallet è liquidato integralmente all&apos;Utente, anche se inferiore a 500 €</strong>, previa emissione dei documenti fiscali e regolarizzazione di quanto eventualmente dovuto a Passaggio Veloce.
          </p>
          <p>
            <strong>12.5 &mdash; Tassatività.</strong> Al di fuori delle ipotesi elencate nella presente clausola, Passaggio Veloce <strong>non adotta alcuna misura limitativa, sospensiva o interruttiva</strong> dell&apos;account o delle singole utenze. Restano ferme le <strong>misure tecniche di sicurezza</strong> a protezione dell&apos;account, quali il blocco temporaneo dell&apos;accesso dopo ripetuti tentativi di login falliti: non hanno natura sanzionatoria e non costituiscono una misura ai sensi della presente clausola. <strong>In nessun caso</strong> la limitazione, la sospensione (dell&apos;account o della singola utenza) o la cancellazione comportano <strong>la perdita dei compensi già maturati</strong>{' '}dall&apos;Utente. L&apos;Utente accetta espressamente le misure di limitazione operativa, sospensione dell&apos;account, sospensione della singola utenza e cancellazione dell&apos;account disciplinate dalla presente clausola (clausola vessatoria: v. clausola {ART_APPROVAZIONE_SPECIFICA}).
          </p>
        </Section>

        <Section title="13. Limitazioni di responsabilità e continuità del servizio">
          <p>
            Passaggio Veloce risponde esclusivamente del corretto funzionamento tecnologico della Piattaforma e della corretta esecuzione delle transazioni economiche tracciate. Nei limiti consentiti dalla legge, Passaggio Veloce <strong>non è responsabile</strong>{' '}di: (a) errori, omissioni o falsità nei dati e documenti caricati dall&apos;Utente; (b) operato, ritardi o inadempimenti delle agenzie o dei broker nell&apos;esecuzione delle pratiche; (c) danni indiretti, consequenziali, perdita di profitto, perdita di opportunità commerciali o danni reputazionali di qualsiasi natura.
          </p>
          <p>
            <strong>Limitazione del danno risarcibile.</strong>{' '}Ove una responsabilità di Passaggio Veloce fosse accertata in via definitiva, il danno risarcibile è limitato come segue: (a) per danni derivanti da <strong>negligenza ordinaria</strong> o da disservizi tecnici non imputabili a dolo o colpa grave, il risarcimento <strong>non può eccedere l&apos;importo delle fee corrisposte</strong> dall&apos;Utente a Passaggio Veloce nei <strong>dodici mesi</strong> precedenti l&apos;evento dannoso; (b) per danni derivanti da <strong>dolo o colpa grave</strong> di Passaggio Veloce, il cap di cui al punto (a) <strong>non si applica</strong>{' '}e la responsabilità è determinata secondo le norme ordinarie, fermo restando che Passaggio Veloce non risponde in nessun caso di danni indiretti, consequenziali o perdita di profitto anche in caso di dolo o colpa grave.
          </p>
          <p>
            <strong>Continuità del servizio.</strong>{' '}La Piattaforma è fornita <strong>nello stato in cui si trova</strong> (as-is). Passaggio Veloce non garantisce la disponibilità continua e ininterrotta del servizio e non è responsabile di interruzioni, rallentamenti o malfunzionamenti tecnici non imputabili a dolo o colpa grave, ivi inclusi i <em>down</em> dei sistemi di terzi (provider cloud, banche, Agenzia delle Entrate, SDI). In caso di interruzione prolungata del servizio causata da Passaggio Veloce, l&apos;unico rimedio dell&apos;Utente è il <strong>recesso senza penali</strong>{' '}ai sensi della clausola 19.
          </p>
          <p>
            L&apos;Utente accetta espressamente le presenti limitazioni di responsabilità (clausola vessatoria: v. clausola {ART_APPROVAZIONE_SPECIFICA}).
          </p>
        </Section>

        <Section title="14. Forza maggiore">
          <p>
            Passaggio Veloce non è responsabile di ritardi, interruzioni o inadempimenti derivanti da <strong>cause di forza maggiore</strong>, intendendosi per tali eventi imprevedibili e non controllabili da Passaggio Veloce, inclusi a titolo esemplificativo: calamità naturali, eventi atmosferici eccezionali, epidemie, atti di guerra o terrorismo, provvedimenti dell&apos;Autorità, scioperi generali, interruzioni delle reti di telecomunicazione o di energia elettrica, attacchi informatici su larga scala, malfunzionamenti dei sistemi di terzi indipendenti da Passaggio Veloce (provider cloud, istituti bancari, Agenzia delle Entrate, SDI).
          </p>
          <p>
            In caso di evento di forza maggiore, Passaggio Veloce ne dà comunicazione all&apos;Utente nel più breve tempo possibile e si adopera per ripristinare il servizio con la massima diligenza. Se l&apos;evento si protrae per più di <strong>30 (trenta) giorni consecutivi</strong>, ciascuna parte ha diritto di <strong>recedere senza penali</strong>, con effetto immediato dalla comunicazione del recesso.
          </p>
        </Section>

        <Section title="15. Proprietà intellettuale">
          <p>
            La Piattaforma, il codice sorgente, il brand, il logo, i marchi, i brevetti, gli algoritmi, i sistemi di matching, i modelli di intelligenza artificiale, i dati aggregati e le statistiche generate dall&apos;attività sulla Piattaforma, la documentazione tecnica e ogni altro elemento della Piattaforma sono di <strong>esclusiva proprietà di Passaggio Veloce S.r.l.</strong>{' '}e sono protetti dalla normativa applicabile in materia di proprietà intellettuale e industriale.
          </p>
          <p>
            L&apos;Utente <strong>non acquisisce alcun diritto di proprietà intellettuale</strong>{' '}sulla Piattaforma per effetto della registrazione o dell&apos;utilizzo del servizio. È espressamente vietato: (a) copiare, riprodurre, modificare o distribuire la Piattaforma o suoi componenti; (b) decompilare o tentare di estrarre il codice sorgente, salvo nei limiti consentiti dalla Direttiva UE 2009/24/CE; (c) utilizzare il brand o il logo di Passaggio Veloce senza previa autorizzazione scritta; (d) estrarre o riutilizzare i dati aggregati della Piattaforma per finalità proprie o di terzi; (e) replicare, anche parzialmente, il modello di business, gli algoritmi o i sistemi della Piattaforma.
          </p>
          <p>
            Passaggio Veloce si riserva il diritto di agire legalmente nei confronti di qualsiasi Utente che violi le presenti disposizioni, richiedendo il risarcimento del danno patrimoniale e non patrimoniale subito. L&apos;Utente accetta espressamente i presenti divieti, incluso il divieto di reverse engineering (clausola vessatoria: v. clausola {ART_APPROVAZIONE_SPECIFICA}).
          </p>
        </Section>

        <Section title="16. Riservatezza dei dati commerciali e divieto di elusione della Piattaforma">
          <p>
            <strong>16.1 &mdash; Obbligo di riservatezza.</strong>{' '}Le informazioni commerciali acquisite dall&apos;Utente attraverso l&apos;utilizzo della Piattaforma &mdash; incluse le relazioni commerciali tra broker e agenzie instaurate tramite la Piattaforma, i volumi di pratiche, le tariffe, le condizioni commerciali, i dati di contatto degli operatori conosciuti tramite la Piattaforma e qualsiasi altra informazione riservata &mdash; sono da considerarsi <strong>informazioni riservate</strong>{' '}e di proprietà di Passaggio Veloce.
          </p>
          <p>
            L&apos;Utente si impegna a non divulgare tali informazioni a terzi non autorizzati e a non utilizzarle per finalità estranee all&apos;utilizzo del servizio. L&apos;obbligo di riservatezza si applica durante tutta la durata del rapporto contrattuale e permane fino a quando le informazioni restano riservate o comunque non siano divenute di pubblico dominio per cause non imputabili all&apos;Utente.
          </p>
          <p>
            <strong>16.2 &mdash; Divieto di elusione della Piattaforma.</strong>{' '}L&apos;Utente si impegna a <strong>non contattare direttamente</strong> broker o agenzie conosciuti tramite la Piattaforma &mdash; ovvero con i quali è entrato in contatto esclusivamente grazie all&apos;utilizzo del servizio &mdash; al fine di gestire pratiche di passaggio di proprietà <strong>al di fuori della Piattaforma</strong>, eludendo in tal modo il pagamento delle fee dovute a Passaggio Veloce ai sensi della clausola 3.
          </p>
          <p>
            Il presente divieto si applica durante tutta la durata del rapporto contrattuale e per i <strong>12 (dodici) mesi successivi</strong> alla cessazione dello stesso, limitatamente agli operatori conosciuti <strong>esclusivamente</strong>{' '}tramite la Piattaforma e alle pratiche del medesimo tipo intermediato da Passaggio Veloce.
          </p>
          <p>
            La violazione del divieto di elusione costituisce <strong>inadempimento grave</strong>{' '}che legittima Passaggio Veloce alla risoluzione immediata del contratto, alla sospensione dell&apos;account e al risarcimento del danno, incluso il lucro cessante corrispondente alle fee che sarebbero state dovute sulle pratiche gestite in elusione. L&apos;Utente accetta espressamente l&apos;obbligo di riservatezza e il divieto di elusione (clausola vessatoria: v. clausola {ART_APPROVAZIONE_SPECIFICA}).
          </p>
        </Section>

        <Section title="17. Divieto di cessione del contratto">
          <p>
            L&apos;Utente <strong>non può cedere, trasferire o sublicenziare</strong>{' '}i diritti e gli obblighi derivanti dal presente contratto a terzi, senza il preventivo consenso scritto di Passaggio Veloce. Qualsiasi cessione effettuata in violazione è nulla e priva di effetti nei confronti di Passaggio Veloce.
          </p>
          <p>
            In caso di cessione o trasferimento dell&apos;attività imprenditoriale dell&apos;Utente (fusione, acquisizione, cessione di ramo d&apos;azienda), l&apos;Utente è tenuto a informare tempestivamente Passaggio Veloce, che si riserva il diritto di richiedere la <strong>verifica KYC del soggetto subentrante</strong>{' '}e, in caso di esito negativo, di risolvere il contratto con preavviso di 30 giorni. I compensi maturati fino alla risoluzione sono liquidati all&apos;avente diritto.
          </p>
          <p>
            Passaggio Veloce si riserva il diritto di cedere il presente contratto a società controllate, controllanti o collegate, nonché in caso di operazioni straordinarie, previa comunicazione all&apos;Utente con preavviso di 30 giorni.
          </p>
        </Section>

        <Section title="18. Modifiche ai Termini">
          <p>
            Passaggio Veloce può modificare i presenti Termini con <strong>preavviso di 30
            giorni</strong>{' '}notificato via email. Per le modifiche sostanziali (in particolare
            ambito del servizio e struttura dei corrispettivi diversa dalla variazione di cui alla
            clausola 3) sarà richiesta la <strong>riaccettazione esplicita</strong>. La prosecuzione
            nell&apos;uso della Piattaforma dopo l&apos;efficacia delle modifiche non sostanziali ne
            comporta l&apos;accettazione.
          </p>
        </Section>

        <Section title="19. Durata e recesso">
          <p>
            Il rapporto è a <strong>tempo indeterminato</strong>. Ciascuna parte può recedere
            liberamente in qualsiasi momento con <strong>preavviso di 30 giorni</strong>{' '}comunicato
            via email. Il recesso non pregiudica le obbligazioni economiche già maturate né i
            documenti fiscali già emessi.
          </p>
        </Section>

        <Section title="20. Integrità del contratto e nullità parziale">
          <p>
            I presenti Termini, unitamente all&apos;<Link href="/privacy" className="font-semibold text-pv-navy-700 hover:underline">Informativa Privacy</Link>{' '}e a qualsiasi altra policy pubblicata su passaggioveloce.it, costituiscono l&apos;<strong>intero accordo</strong>{' '}tra le parti in relazione all&apos;utilizzo della Piattaforma e sostituiscono integralmente qualsiasi comunicazione, trattativa, proposta o accordo precedente, sia scritto che verbale, avente il medesimo oggetto.
          </p>
          <p>
            Qualora una o più clausole dei presenti Termini siano dichiarate nulle, annullabili o inapplicabili da un&apos;autorità competente, le <strong>restanti clausole mantengono piena validità ed efficacia</strong>. La clausola nulla sarà sostituita, ove possibile, da una clausola valida che si avvicini il più possibile all&apos;intenzione economica e giuridica delle parti.
          </p>
        </Section>

        <Section title="21. Comunicazioni ufficiali">
          <p>
            Tutte le comunicazioni ufficiali tra Passaggio Veloce e l&apos;Utente avvengono <strong>via email</strong> agli indirizzi indicati in fase di registrazione o successivamente aggiornati dall&apos;Utente nel proprio profilo. Le comunicazioni via email si considerano <strong>ricevute entro 24 (ventiquattro) ore dall&apos;invio</strong>, indipendentemente dall&apos;effettiva lettura, a condizione che non sia pervenuta al mittente una notifica di mancato recapito entro tale termine.
          </p>
          <p>
            L&apos;Utente è responsabile del mantenimento aggiornato del proprio indirizzo email. Passaggio Veloce non è responsabile di comunicazioni non ricevute per effetto di un indirizzo non aggiornato, di filtri antispam o di malfunzionamenti del servizio email dell&apos;Utente.
          </p>
          <p>
            Per comunicazioni urgenti (sospensione account, penali confermate, interruzioni del servizio) Passaggio Veloce potrà avvalersi anche di <strong>notifiche in Piattaforma</strong> e/o <strong>SMS</strong>{' '}al numero di telefono indicato in registrazione, in aggiunta alla comunicazione via email.
          </p>
        </Section>

        <Section title="22. Trattamento dei dati personali">
          <p>
            Il trattamento dei dati personali è disciplinato dall&apos;
            <Link href="/privacy" className="font-semibold text-pv-navy-700 hover:underline">
              Informativa Privacy
            </Link>
            , conforme al Regolamento (UE) 2016/679 (GDPR), che l&apos;Utente dichiara di aver preso
            visione. I dati di venditori e acquirenti sono disciplinati dalla clausola {ART_DATI_TERZI} e
            dall&apos;
            <Link
              href="/privacy/clienti"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              Informativa per venditori e acquirenti
            </Link>
            .
          </p>
        </Section>

        <Section title="23. Dati di venditori, acquirenti e altri terzi">
          <p>
            <strong>23.1 &mdash; Ruoli.</strong>{' '}Nel caricare sulla Piattaforma i dati personali di
            venditori, acquirenti e altri soggetti terzi (i &laquo;<strong>Terzi</strong>&raquo;),
            l&apos;Utente agisce quale <strong>titolare del trattamento</strong>{' '}nei confronti dei
            propri clienti. Passaggio Veloce tratta i dati dei Terzi quale{' '}
            <strong>titolare autonomo</strong>, per le proprie finalità (erogazione del servizio,
            adempimenti fiscali, prevenzione delle frodi e finalità commerciali proprie), e{' '}
            <strong>non</strong>{' '}in qualità di responsabile del trattamento ai sensi
            dell&apos;art. 28 GDPR.
          </p>
          <p>
            <strong>23.2 &mdash; Garanzia e responsabilità dell&apos;Utente.</strong>{' '}L&apos;Utente garantisce di aver reso ai Terzi l&apos;informativa prevista dall&apos;art. 13 GDPR e di averli informati che i loro dati personali e i loro documenti sono comunicati a Passaggio Veloce per la gestione della pratica. L&apos;Utente garantisce di avere titolo per conferire tali dati. La responsabilità dell&apos;ottenimento della <strong>base giuridica</strong> per il trattamento dei dati dei Terzi nei confronti di Passaggio Veloce è <strong>integralmente e in via esclusiva dell&apos;Utente</strong>.
          </p>
          <p>
            <strong>23.3 &mdash; Informativa di Passaggio Veloce ai Terzi.</strong>{' '}Passaggio Veloce rende
            ai Terzi la propria informativa ai sensi dell&apos;art. 14 GDPR (
            <Link
              href="/privacy/clienti"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              Informativa per venditori e acquirenti
            </Link>
            ), anche tramite le comunicazioni email sull&apos;avanzamento della pratica. Passaggio Veloce conserva i dati dei Terzi per il periodo imposto dalla normativa applicabile, in particolare per gli obblighi fiscali e contabili.
          </p>
          <p>
            <strong>23.4 &mdash; Minimizzazione.</strong>{' '}L&apos;Utente carica esclusivamente i
            dati e i documenti necessari alla lavorazione della pratica e si astiene dal conferire
            dati ulteriori.
          </p>
          <p>
            <strong>23.5 &mdash; Manleva.</strong>{' '}L&apos;Utente tiene indenne Passaggio Veloce da ogni pretesa, reclamo, contestazione, danno o sanzione &mdash; anche dell&apos;Autorità Garante &mdash; che derivi dalla violazione delle garanzie di cui alle clausole 23.2 e 23.4, ivi incluse le pretese avanzate <strong>direttamente dai Terzi</strong> nei confronti di Passaggio Veloce per trattamento di dati non autorizzato o privo di base giuridica imputabile all&apos;Utente. La presente manleva si estende alle <strong>spese legali ragionevolmente sostenute</strong>{' '}da Passaggio Veloce (clausola vessatoria: v. clausola {ART_APPROVAZIONE_SPECIFICA}).
          </p>
          <p>
            <strong>23.6 &mdash; Violazioni dei dati personali.</strong>{' '}Ciascuna parte informa
            l&apos;altra <strong>senza ingiustificato ritardo</strong>{' '}di ogni violazione di dati
            personali (art. 4 n. 12 GDPR) che riguardi i dati dei Terzi trattati tramite la
            Piattaforma, e coopera per gli adempimenti di cui agli artt. 33 e 34 GDPR.
          </p>
        </Section>

        <Section title="24. Legge applicabile e foro competente">
          <p>
            I presenti Termini sono regolati dalla <strong>legge italiana</strong>. Per ogni
            controversia relativa alla loro interpretazione ed esecuzione è competente in via
            esclusiva il foro del luogo in cui ha sede legale Passaggio Veloce S.r.l. L&apos;Utente
            accetta espressamente tale deroga alla competenza territoriale (clausola vessatoria: v.
            clausola {ART_APPROVAZIONE_SPECIFICA}).
          </p>
        </Section>

        <Section title="25. Approvazione specifica delle clausole (artt. 1341 e 1342 c.c.)">
          <p>
            Ai sensi e per gli effetti degli <strong>artt. 1341 e 1342 c.c.</strong>, l&apos;Utente
            dichiara di aver letto e di <strong>approvare specificamente</strong>{' '}le seguenti
            clausole:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {CLAUSOLE_VESSATORIE.map((n) => (
              <li key={n}>
                <strong>Clausola {n}</strong>{' '}— {DESCRIZIONI_VESSATORIE[n]}
              </li>
            ))}
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
          email agli Utenti registrati con il preavviso di cui alla clausola 18.
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
