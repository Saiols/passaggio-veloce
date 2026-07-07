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
        <p className="mt-2 text-[12px] text-pv-slate-500">Ultimo aggiornamento: 2026-07-07</p>

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
            I compensi maturati dall&apos;Utente (compensi pratica e commissioni di affiliazione)
            sono accreditati su un portafoglio elettronico (&laquo;wallet&raquo;) alla{' '}
            <strong>firma</strong> della relativa pratica. Il saldo del wallet rappresenta un credito
            dell&apos;Utente verso Passaggio Veloce, erogabile secondo le condizioni che seguono.
          </p>
          <p>
            <strong>Il prelievo (payout) è disponibile solo al raggiungimento di un saldo minimo di
            500 €.</strong> Al raggiungimento della soglia di payout automatico configurata
            dall&apos;Utente (di regola 1.000 €, comunque impostabile tra 1.000 € e 5.000 €)
            l&apos;erogazione è avviata automaticamente. L&apos;erogazione avviene mediante bonifico
            sull&apos;IBAN indicato dall&apos;Utente.
          </p>
          <p>
            In caso di penali o rettifiche il saldo del wallet può risultare negativo: in tale
            ipotesi i payout sono sospesi fino al ripristino di un saldo positivo, mentre i compensi
            successivi continuano ad accreditarsi a compensazione. L&apos;Utente accetta
            espressamente le presenti condizioni di prelievo (clausola vessatoria: v. clausola 17).
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

        <Section title="10. Sistema di segnalazioni e penali">
          <p>
            La Piattaforma prevede un sistema di segnalazioni relative alla gestione delle pratiche
            (ad esempio ipoteche o fermi non dichiarati) e l&apos;applicazione di penali a carico del
            broker nei casi previsti, con addebito sul relativo wallet. L&apos;Utente accetta
            l&apos;applicazione delle penali secondo le regole indicate in Piattaforma (clausola
            vessatoria: v. clausola 17).
          </p>
        </Section>

        <Section title="11. Sospensione, anti-abuso e cancellazione dell'account">
          <p>
            Passaggio Veloce può sospendere o cancellare, anche senza preavviso in caso di urgenza,
            l&apos;account dell&apos;Utente in ipotesi di frode, abuso del programma di affiliazione,
            reiterata mancata accettazione delle pratiche assegnate (anti-abuso), mancato pagamento
            delle fee, violazione dei presenti Termini o richiesta dell&apos;Autorità. L&apos;Utente
            accetta espressamente tale facoltà (clausola vessatoria: v. clausola 17).
          </p>
          <p>
            L&apos;Utente può richiedere la cessazione del servizio scrivendo a{' '}
            <a
              href="mailto:assistenza@passaggioveloce.it"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              assistenza@passaggioveloce.it
            </a>
            . Restano dovuti gli importi maturati fino alla cessazione.
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
              <strong>5</strong> (Wallet e condizioni di prelievo, incluso il saldo minimo e la
              sospensione dei payout in caso di saldo negativo);
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
              <strong>11</strong> (Sospensione, anti-abuso e cancellazione dell&apos;account);
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
