# Copertura GDPR dati di venditore e acquirente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare a venditore e acquirente — che non hanno alcun contratto con PV ma di cui trattiamo i documenti d'identità — l'informativa che oggi non hanno mai avuto, e mettere nei Termini del broker la garanzia con manleva che copre il conferimento.

**Architecture:** PV è **titolare autonomo** (non responsabile ex art. 28: scegliamo noi il provider OCR, la retention, e col sistema penali sanzioniamo il broker che dovrebbe essere il nostro titolare — l'art. 28(10) ci renderebbe comunque titolari di fatto). Nuova clausola 17 nei Termini (garanzia + manleva, vessatoria → rinumerazione 17→18, 18→19), nuova pagina `/privacy/clienti` con l'informativa art. 14, recapitata dalla mail N40 che già inviamo, `/privacy` resa veritiera su storage/categorie/retention.

**Tech Stack:** Next.js 16 App Router, React Server Components, TypeScript, Vitest, Prisma, Tailwind (design system PV).

## Global Constraints

- **Tutto è DRAFT legale.** Ogni pagina toccata conserva (o riceve) la nota «da sottoporre a revisione legale prima del go-live». Non rimuovere quelle note.
- **Nessuna migration.** Zero modifiche allo schema Prisma. Se un task sembra richiederne una, fermarsi e segnalare.
- **Nessuna checkbox di consenso privacy** in registrazione: l'informativa si prende in visione, non si consente. Aggiungerne una sarebbe legalmente peggiorativa (suggerirebbe una base revocabile che non abbiamo).
- **Base giuridica verso i terzi:** art. 6.1.f (legittimo interesse) + art. 6.1.c (obbligo legale). **Mai** «consenso», **mai** art. 6.1.b verso il terzo (il contratto è col broker).
- **Fonte unica dei numeri di clausola:** `apps/piattaforma/src/lib/legal/clausole-vessatorie.ts`. Nessun numero di clausola scritto a mano nel JSX quando esiste la costante.
- **Colori:** solo token del design system (`text-pv-navy-900`, `text-pv-slate-700`, …). Nessun colore hardcoded nelle pagine. Le email HTML sono l'eccezione già in essere (client email non leggono le CSS var): là si seguono gli hex già usati in `templates.ts`.
- **Comandi** (da `apps/piattaforma/`): test `pnpm --filter piattaforma test`, typecheck `pnpm --filter piattaforma typecheck`, lint `pnpm --filter piattaforma lint`, dev `pnpm --filter piattaforma dev`.
- **Node:** `nvm use 22.15.0` prima di qualsiasi comando pnpm (post-riavvio la shell torna a Node 16).

---

### Task 1: Fonte unica — rinumerazione e nuova clausola vessatoria

Questo task **non tocca il testo dei Termini**: sposta solo i numeri nella fonte unica. Il test esistente blinda l'invariante e diventerà rosso: è il punto.

**Files:**
- Modify: `apps/piattaforma/src/lib/legal/clausole-vessatorie.ts`
- Test: `apps/piattaforma/src/lib/legal/clausole-vessatorie.test.ts`

**Interfaces:**
- Consumes: niente.
- Produces: `ART_APPROVAZIONE_SPECIFICA = 19`, `CLAUSOLE_VESSATORIE = [3,5,7,8,10,11,12,13,17,18]`, `DESCRIZIONI_VESSATORIE` con le chiavi `17` (dati terzi) e `18` (foro), `TERMS_VERSION = '2026-07-14'`. Consumati da Task 2 (`termini/page.tsx`) e, già oggi, da `register-wizard.tsx` (che non va toccato: legge la fonte unica).

- [ ] **Step 1: Aggiornare il test alle attese nuove (rosso atteso)**

In `clausole-vessatorie.test.ts` sostituire i tre test che citano i numeri vecchi:

```ts
  it('elenca le clausole approvate specificamente ex 1341/1342', () => {
    expect([...CLAUSOLE_VESSATORIE]).toEqual([3, 5, 7, 8, 10, 11, 12, 13, 17, 18]);
  });

  it("l'articolo di approvazione specifica è il 19", () => {
    expect(ART_APPROVAZIONE_SPECIFICA).toBe(19);
  });

  it('rende l\'elenco come stringa leggibile per la checkbox', () => {
    expect(elencoClausoleVessatorie()).toBe('3, 5, 7, 8, 10, 11, 12, 13, 17, 18');
  });
```

Aggiungere in coda al `describe` un test che blinda il significato, non solo il numero — è la trappola vera della rinumerazione (una descrizione che resta agganciata al numero sbagliato produce un contratto che promette una cosa e ne elenca un'altra):

```ts
  it('la 17 è la garanzia/manleva sui dati dei terzi e la 18 è il foro (non invertite)', () => {
    // Rinumerando, il rischio non è perdere una chiave — il test sopra lo
    // vedrebbe — ma lasciarla attaccata alla descrizione vecchia: l'elenco
    // dell'approvazione specifica direbbe "Clausola 17 — foro competente"
    // mentre la 17 dei Termini parla di dati personali di terzi.
    expect(DESCRIZIONI_VESSATORIE[17]).toMatch(/dati di venditori e acquirenti/i);
    expect(DESCRIZIONI_VESSATORIE[18]).toMatch(/foro/i);
  });
```

- [ ] **Step 2: Eseguire il test e verificare che FALLISCA**

Run: `pnpm --filter piattaforma test -- clausole-vessatorie`
Expected: FAIL. Almeno `expected [3,5,7,8,10,11,12,13,17] to deeply equal [3,5,7,8,10,11,12,13,17,18]` e `expected 18 to be 19`.

- [ ] **Step 3: Aggiornare la fonte unica**

In `clausole-vessatorie.ts`, sostituire le costanti (righe 12-46):

```ts
/** Numero dell'articolo di approvazione specifica ex artt. 1341-1342 c.c. */
export const ART_APPROVAZIONE_SPECIFICA = 19;

/**
 * Clausole che l'Utente approva specificamente con la seconda spunta in
 * registrazione. Ordinate, senza duplicati, tutte < ART_APPROVAZIONE_SPECIFICA.
 */
export const CLAUSOLE_VESSATORIE = [3, 5, 7, 8, 10, 11, 12, 13, 17, 18] as const;

/**
 * Descrizione sintetica di ogni clausola vessatoria, per il render dell'art. 19
 * (`app/termini/page.tsx`). Le CHIAVI devono coprire esattamente
 * CLAUSOLE_VESSATORIE: se manca una chiave il render mostra `undefined`, se ne
 * avanza una è una descrizione orfana di una clausola non più vessatoria.
 * `clausole-vessatorie.test.ts` blinda questa invariante confrontando le due
 * chiavi — non fidarsi solo dell'occhio.
 */
export const DESCRIZIONI_VESSATORIE: Record<(typeof CLAUSOLE_VESSATORIE)[number], string> = {
  3: 'variazione del prezzo del servizio a discrezione del Gestore',
  5: 'condizioni e soglia di prelievo del wallet (payout)',
  7: 'determinazione differenziata del compenso in base al regime fiscale',
  8: 'manleva in materia di visura camerale',
  10: 'sistema di segnalazioni e penali',
  11: 'potere di attestazione della firma da parte del Gestore',
  12: 'limitazione operativa, sospensione e cancellazione dell’account',
  13: 'limitazioni di responsabilità',
  17: 'garanzia e manleva sui dati di venditori e acquirenti',
  18: 'deroga alla competenza territoriale (foro esclusivo)',
};

/**
 * Versione dei Termini in vigore, persistita su `Company.termsVersion` al
 * momento dell'accettazione: senza, non sappiamo QUALE testo l'utente ha
 * accettato. Aggiornare a ogni modifica sostanziale della pagina /termini.
 */
export const TERMS_VERSION = '2026-07-14';
```

- [ ] **Step 4: Eseguire il test e verificare che PASSI**

Run: `pnpm --filter piattaforma test -- clausole-vessatorie`
Expected: PASS, 8 test.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/legal/clausole-vessatorie.ts apps/piattaforma/src/lib/legal/clausole-vessatorie.test.ts
git commit -m "feat(termini): la clausola 17 diventa la garanzia sui dati dei terzi, il foro slitta alla 18"
```

---

### Task 2: Termini — clausola 17 «Dati di venditori, acquirenti e altri terzi»

**Files:**
- Modify: `apps/piattaforma/src/app/termini/page.tsx` (righe 21-36 commento, 52 data, 398-437 clausole 16/17/18)

**Interfaces:**
- Consumes: `ART_APPROVAZIONE_SPECIFICA` (= 19), `CLAUSOLE_VESSATORIE`, `DESCRIZIONI_VESSATORIE` da Task 1 — già importati in cima al file, non serve toccare gli import.
- Produces: la Section «17. Dati di venditori, acquirenti e altri terzi» e il link a `/privacy/clienti` (pagina creata da Task 3 — il link resta 404 fino ad allora: è atteso, i due task sono indipendenti e vengono committati separatamente).

- [ ] **Step 1: Sostituire il blocco clausole 16→18 con 16→19**

Sostituire integralmente le righe 398-437 (dalla `<Section title="16. …">` alla `</Section>` della 18) con:

```tsx
        <Section title="16. Trattamento dei dati personali">
          <p>
            Il trattamento dei dati personali è disciplinato dall&apos;
            <Link href="/privacy" className="font-semibold text-pv-navy-700 hover:underline">
              Informativa Privacy
            </Link>
            , conforme al Regolamento (UE) 2016/679 (GDPR), che l&apos;Utente dichiara di aver preso
            visione. I dati di venditori e acquirenti sono disciplinati dalla clausola 17 e
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

        <Section title="17. Dati di venditori, acquirenti e altri terzi">
          <p>
            <strong>17.1 &mdash; Ruoli.</strong> Nel caricare sulla Piattaforma i dati personali di
            venditori, acquirenti e altri soggetti terzi (i &laquo;<strong>Terzi</strong>&raquo;),
            l&apos;Utente agisce quale <strong>titolare del trattamento</strong> nei confronti dei
            propri clienti. Passaggio Veloce tratta i dati dei Terzi quale{' '}
            <strong>titolare autonomo</strong>, per le proprie finalità (erogazione del servizio,
            prevenzione delle frodi, adempimenti fiscali e di legge), e{' '}
            <strong>non</strong> in qualità di responsabile del trattamento ai sensi
            dell&apos;art. 28 GDPR.
          </p>
          <p>
            <strong>17.2 &mdash; Garanzia dell&apos;Utente.</strong> L&apos;Utente garantisce di
            aver reso ai Terzi l&apos;informativa prevista dall&apos;art. 13 GDPR e di averli
            informati che i loro dati sono comunicati a Passaggio Veloce per la gestione della
            pratica, e di avere titolo per conferirli.
          </p>
          <p>
            <strong>17.3 &mdash; Informativa di Passaggio Veloce.</strong> Passaggio Veloce rende
            ai Terzi la propria informativa ai sensi dell&apos;art. 14 GDPR (
            <Link
              href="/privacy/clienti"
              className="font-semibold text-pv-navy-700 hover:underline"
            >
              Informativa per venditori e acquirenti
            </Link>
            ), anche tramite le comunicazioni email sull&apos;avanzamento della pratica.
          </p>
          <p>
            <strong>17.4 &mdash; Minimizzazione.</strong> L&apos;Utente carica esclusivamente i
            dati e i documenti necessari alla lavorazione della pratica e si astiene dal conferire
            dati ulteriori.
          </p>
          <p>
            <strong>17.5 &mdash; Manleva.</strong> L&apos;Utente tiene indenne Passaggio Veloce da
            ogni pretesa, reclamo, contestazione o sanzione, anche dell&apos;Autorità Garante, che
            derivi dalla violazione delle garanzie di cui alle clausole 17.2 e 17.4 (clausola
            vessatoria: v. clausola {ART_APPROVAZIONE_SPECIFICA}).
          </p>
          <p>
            <strong>17.6 &mdash; Violazioni dei dati personali.</strong> Ciascuna parte informa
            l&apos;altra <strong>senza ingiustificato ritardo</strong> di ogni violazione di dati
            personali (art. 4 n. 12 GDPR) che riguardi i dati dei Terzi trattati tramite la
            Piattaforma, e coopera per gli adempimenti di cui agli artt. 33 e 34 GDPR.
          </p>
        </Section>

        <Section title="18. Legge applicabile e foro competente">
          <p>
            I presenti Termini sono regolati dalla <strong>legge italiana</strong>. Per ogni
            controversia relativa alla loro interpretazione ed esecuzione è competente in via
            esclusiva il foro del luogo in cui ha sede legale Passaggio Veloce S.r.l. L&apos;Utente
            accetta espressamente tale deroga alla competenza territoriale (clausola vessatoria: v.
            clausola {ART_APPROVAZIONE_SPECIFICA}).
          </p>
        </Section>

        <Section title="19. Approvazione specifica delle clausole (artt. 1341 e 1342 c.c.)">
          <p>
            Ai sensi e per gli effetti degli <strong>artt. 1341 e 1342 c.c.</strong>, l&apos;Utente
            dichiara di aver letto e di <strong>approvare specificamente</strong> le seguenti
            clausole:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {CLAUSOLE_VESSATORIE.map((n) => (
              <li key={n}>
                <strong>Clausola {n}</strong> — {DESCRIZIONI_VESSATORIE[n]}
              </li>
            ))}
          </ul>
          <p className="mt-3">
            L&apos;approvazione specifica delle predette clausole è raccolta, in fase di
            registrazione, mediante apposita e distinta accettazione, in aggiunta all&apos;accettazione
            generale dei presenti Termini.
          </p>
        </Section>
```

- [ ] **Step 2: Aggiornare data e commento di testa**

Riga 52 — la data mostrata all'utente deve combaciare con `TERMS_VERSION`:

```tsx
        <p className="mt-2 text-[12px] text-pv-slate-500">Ultimo aggiornamento: 2026-07-14</p>
```

Riga 26 (commento JSDoc — è testo di commento, non interpola: va scritto a mano):

```
 * elencate alla clausola 19 e richiedono la seconda accettazione specifica
```

E aggiungere in coda al blocco JSDoc, prima di ` */`:

```
 *
 * Revisione 2026-07-14: nuova clausola 17 (dati di venditori e acquirenti —
 * PV titolare autonomo, garanzia + manleva dell'Utente). Foro → 18,
 * approvazione specifica → 19. Spec:
 * docs/superpowers/specs/2026-07-14-gdpr-dati-terzi-design.md
```

- [ ] **Step 3: Verificare che non resti nessun numero fossile**

Run: `grep -n "clausola 17\|clausola 18\|title=\"17\.\|title=\"18\.\|title=\"19\." apps/piattaforma/src/app/termini/page.tsx`

Expected: **nessun** `clausola 17` / `clausola 18` letterale (i rimandi all'articolo di approvazione sono interpolazioni `{ART_APPROVAZIONE_SPECIFICA}`); esattamente una `title="17. Dati di venditori…`, una `title="18. Legge applicabile…`, una `title="19. Approvazione specifica…`.

- [ ] **Step 4: Verificare i rimandi interni superstiti**

Run: `grep -n "clausola 1[0-9]" apps/piattaforma/src/app/termini/page.tsx`

Expected: solo rimandi a **10, 11, 12, 14** (penali, firma, sospensione, preavviso modifiche) — tutti sotto la 16, quindi non toccati dalla rinumerazione. Se compare un rimando a 15/16/17/18 **fermarsi**: è un riferimento che la rinumerazione ha reso falso.

- [ ] **Step 5: Test + typecheck**

Run: `pnpm --filter piattaforma test -- clausole-vessatorie && pnpm --filter piattaforma typecheck`
Expected: PASS, 0 errori.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/termini/page.tsx
git commit -m "feat(termini): clausola 17 sui dati di venditori e acquirenti (titolare autonomo, garanzia, manleva)"
```

---

### Task 3: Nuova pagina `/privacy/clienti` — informativa art. 14

La `/privacy` esistente è scritta per il broker (IBAN, Stripe, regime fiscale, KYC del legale rappresentante). Un venditore non ci si riconosce. Questa pagina è per lui: linguaggio piano, seconda persona, nessun legalese difensivo.

**Files:**
- Create: `apps/piattaforma/src/app/privacy/clienti/page.tsx`

**Interfaces:**
- Consumes: `SiteHeader`, `JsonLd`, `webPageJsonLd`, `siteUrl` — stessi import di `app/privacy/page.tsx`.
- Produces: la route `/privacy/clienti`, linkata da Task 2 (Termini), Task 4 (`/privacy`) e Task 5 (email N40).

- [ ] **Step 1: Creare la pagina**

```tsx
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
            <strong>Non li abbiamo raccolti da te.</strong> Ce li ha trasmessi il professionista a
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
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint`
Expected: 0 errori.

- [ ] **Step 3: Verifica nel browser (non saltabile)**

Avvia `pnpm --filter piattaforma dev`, apri `http://localhost:3000/privacy/clienti`.
Expected: la pagina renderizza con header, titolo, sette sezioni; nessun errore in console; i link `/privacy` e `/cookie` in fondo funzionano. Il testo renderizzato non deve avere parole incollate (il JSX mangia gli spazi a ridosso dei tag: controllare a occhio i punti con `{' '}`).

- [ ] **Step 4: Commit**

```bash
git add apps/piattaforma/src/app/privacy/clienti/page.tsx
git commit -m "feat(privacy): informativa art. 14 per venditori e acquirenti"
```

---

### Task 4: `/privacy` — rendere vero ciò che oggi è falso

Tre dichiarazioni della privacy policy attuale non corrispondono al codice. La più grave: dichiara che i documenti stanno su **Cloudflare R2**, mentre il codice usa **Vercel Blob** (`lib/providers/storage/vercel-blob.ts`; R2 non esiste nel repo). Oggi la nostra privacy policy dice il falso su dove stanno le carte d'identità.

**Files:**
- Modify: `apps/piattaforma/src/app/privacy/page.tsx` (righe 15-19 commento, 36-38 data, 57-80 tipologie, 102-109 conservazione, 161-165 fornitori, 187-198 footer)

**Interfaces:**
- Consumes: la route `/privacy/clienti` creata da Task 3.
- Produces: niente (pagina terminale).

- [ ] **Step 1: Correggere il fornitore di storage**

Sostituire il `<li>` di Cloudflare R2 (righe 161-164):

```tsx
            <li>
              <strong>Vercel Blob</strong>: archiviazione dei documenti
              caricati (libretti, documenti di identità, visure), regione
              Unione Europea.
            </li>
```

- [ ] **Step 2: Dichiarare le categorie di dati non dichiarate**

Nella Section «Tipologie di dati trattati», sostituire il `<li>` dei dati operativi (righe 64-68) con:

```tsx
            <li>
              <strong>Dati operativi</strong>: documenti caricati per le
              pratiche (libretto di circolazione, carta d&apos;identità,
              patente, passaporto, codice fiscale, visure), dati estratti via
              OCR, comunicazioni con le agenzie.
            </li>
            <li>
              <strong>Dati di venditori e acquirenti</strong> (soggetti terzi
              rispetto all&apos;utente registrato), conferiti dall&apos;utente
              per la lavorazione della pratica. Quando la pratica lo richiede
              includono <strong>permesso di soggiorno</strong>,{' '}
              <strong>certificato di morte</strong> e atti di successione,
              procure e autorizzazioni del giudice tutelare. Rispetto a questi
              dati Passaggio Veloce è titolare autonomo: v.{' '}
              <Link
                href="/privacy/clienti"
                className="font-semibold text-pv-navy-700 hover:underline"
              >
                informativa per venditori e acquirenti
              </Link>
              .
            </li>
```

- [ ] **Step 3: Riscrivere la conservazione su ciò che il codice fa davvero**

La versione attuale promette «10 anni» e una cancellazione che nessun job esegue. Sostituire la Section «Conservazione» (righe 102-109):

```tsx
        <Section title="Conservazione">
          <p>
            I documenti rimossi vengono cancellati definitivamente (dal
            database e dallo storage) <strong>90 giorni</strong> dopo la
            rimozione. Le pratiche rimaste in <strong>bozza</strong> e mai
            inviate, con i relativi documenti, vengono eliminate dopo{' '}
            <strong>30 giorni</strong>.
          </p>
          <p>
            I dati delle pratiche <strong>portate a termine</strong> e i dati
            contabili e fiscali sono conservati per il periodo imposto dalla
            normativa fiscale e dagli obblighi connessi agli adempimenti sul
            veicolo. I dati di un account eliminato sono soft-deleted per{' '}
            <strong>90 giorni</strong> e poi rimossi, fatti salvi gli obblighi
            di conservazione di legge.
          </p>
        </Section>
```

- [ ] **Step 4: Rinviare all'informativa dei clienti finali nel footer**

Sostituire il paragrafo finale (righe 187-198):

```tsx
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
```

- [ ] **Step 5: Aggiornare data e commento di testa**

Riga 37: `Ultimo aggiornamento: 2026-07-14`. Riga 29 (`lastModified` nel JsonLd): `'2026-07-14'`.

Commento JSDoc (righe 15-19):

```
/**
 * Privacy Policy per gli UTENTI REGISTRATI (broker e agenzie). I dati di
 * venditori e acquirenti — soggetti terzi che non hanno un rapporto con noi —
 * hanno un'informativa dedicata ex art. 14: `app/privacy/clienti/page.tsx`.
 *
 * Da rivedere con il legale prima del lancio in prod: aggiungere DPO e
 * ricorso al Garante per categoria.
 * Spec: docs/superpowers/specs/2026-07-14-gdpr-dati-terzi-design.md
 */
```

- [ ] **Step 6: Verificare che «Cloudflare R2» sia sparito**

Run: `grep -rn "Cloudflare R2\|Cloudflare" apps/piattaforma/src/app/privacy/`
Expected: **nessun match**. Se ne resta uno, la privacy continua a dire il falso su dove stanno i documenti di identità.

- [ ] **Step 7: Typecheck + verifica browser**

Run: `pnpm --filter piattaforma typecheck`
Expected: 0 errori.
Browser: `http://localhost:3000/privacy` — le tre sezioni corrette renderizzano, il link a `/privacy/clienti` porta alla pagina del Task 3.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/app/privacy/page.tsx
git commit -m "fix(privacy): storage reale (Vercel Blob, non R2), categorie particolari, retention veritiera"
```

---

### Task 5: Email N40 — l'informativa deve *arrivargli*

L'art. 14 vuole l'informativa **al più tardi alla prima comunicazione** all'interessato. Quella comunicazione già la facciamo: `N40_CLIENTE_AVANZAMENTO`, variante `AVVIATA`, inviata al submit. Serve solo che la porti con sé — e che dica **da chi** abbiamo preso i dati, che è il requisito specifico dell'art. 14.

**Files:**
- Modify: `apps/piattaforma/src/lib/notifiche/templates.ts` (import in testa, payload righe 126-139, `tplN40ClienteAvanzamento` righe 580-666)
- Modify: `apps/piattaforma/src/lib/notifiche/cliente.ts` (select righe 18-72, payload righe 96-107)
- Test: `apps/piattaforma/src/lib/notifiche/templates.test.ts` (describe «N40 cliente avanzamento», dalla riga 32)

**Interfaces:**
- Consumes: la route `/privacy/clienti` (Task 3); `siteUrl` da `@/lib/seo/brand`; la relation Prisma `Pratica.broker` (`@relation("PraticheBroker")`, `schema.prisma:795-796`).
- Produces: `N40ClienteAvanzamentoPayload` guadagna `nomeBroker?: string | null`. Nessun altro consumer.

- [ ] **Step 1: Scrivere i test che falliscono**

In `templates.test.ts`, dentro il `describe('N40 cliente avanzamento', …)`, aggiungere:

```ts
  it('ogni stato porta con sé il link all\'informativa privacy per i clienti', () => {
    // Art. 14 GDPR: l'informativa va resa al più tardi alla prima
    // comunicazione all'interessato. La N40 È quella comunicazione: se il
    // link cade da una variante, quella variante viola l'articolo.
    for (const stato of STATI) {
      const { text, html } = tplN40ClienteAvanzamento({
        codicePratica: 'PV-2026-100',
        veicoloDescrizione: 'AB123CD',
        nomeDestinatario: 'Mario Rossi',
        ruolo: 'VENDITORE',
        stato,
      });
      expect(text, `text/${stato}`).toContain('/privacy/clienti');
      expect(html, `html/${stato}`).toContain('/privacy/clienti');
    }
  });

  it('AVVIATA: dice da CHI abbiamo ricevuto i dati (il broker), che è il punto dell\'art. 14', () => {
    const { text, html } = tplN40ClienteAvanzamento({
      codicePratica: 'PV-2026-101',
      veicoloDescrizione: 'AB123CD',
      nomeDestinatario: 'Mario Rossi',
      ruolo: 'ACQUIRENTE',
      stato: 'AVVIATA',
      nomeBroker: 'Autosalone Bianchi S.r.l.',
    });
    expect(text).toContain('Autosalone Bianchi S.r.l.');
    expect(html).toContain('Autosalone Bianchi S.r.l.');
  });

  it('AVVIATA senza nomeBroker: nessun buco di testo, il link resta', () => {
    // nomeBroker è opzionale: se la select fallisse o la company fosse
    // sparita non dobbiamo scrivere "trasmessi da undefined".
    const { text, html } = tplN40ClienteAvanzamento({
      codicePratica: 'PV-2026-102',
      veicoloDescrizione: null,
      nomeDestinatario: 'Mario Rossi',
      ruolo: 'VENDITORE',
      stato: 'AVVIATA',
    });
    expect(text).not.toContain('undefined');
    expect(html).not.toContain('undefined');
    expect(text).not.toContain('null');
    expect(text).toContain('/privacy/clienti');
  });
```

- [ ] **Step 2: Eseguire i test e verificare che FALLISCANO**

Run: `pnpm --filter piattaforma test -- templates`
Expected: FAIL — 2 test rossi (`toContain('/privacy/clienti')` e `toContain('Autosalone Bianchi S.r.l.')`). Il terzo passa già (è un test di non-regressione): va bene, deve restare verde anche dopo.

- [ ] **Step 3: Estendere il payload**

In `templates.ts`, aggiungere l'import in testa (dopo la riga 11):

```ts
import { siteUrl } from '@/lib/seo/brand';
```

e il campo al payload (in coda a `N40ClienteAvanzamentoPayload`, dopo `agenziaProvincia`):

```ts
  // Ragione sociale del broker che ci ha trasmesso i dati. Art. 14 GDPR: alla
  // prima comunicazione dobbiamo dire all'interessato DA CHI li abbiamo
  // ricevuti — è ciò che distingue questa informativa da quella dell'art. 13.
  nomeBroker?: string | null;
```

- [ ] **Step 4: Aggiungere il blocco privacy al template**

In `tplN40ClienteAvanzamento`, subito dopo `const agenziaHtml = … : '';` (riga ~650), inserire:

```ts
  // Informativa art. 14 GDPR. Su AVVIATA — la PRIMA comunicazione che il
  // cliente riceve da noi — diciamo anche da chi abbiamo avuto i suoi dati.
  const privacyUrl = siteUrl('/privacy/clienti');
  const fonte =
    p.stato === 'AVVIATA' && p.nomeBroker
      ? ` I tuoi dati ci sono stati trasmessi da ${p.nomeBroker} per gestire questa pratica.`
      : '';
  const privacyText =
    `\n\nPasseggio Veloce S.r.l. tratta i tuoi dati per gestire la pratica.${fonte}` +
    ` Qui trovi chi siamo e quali diritti hai: ${privacyUrl}`;
  const privacyHtml = `
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      Passaggio Veloce S.r.l. tratta i tuoi dati per gestire la pratica.${
        fonte ? escapeHtml(fonte) : ''
      }
      Qui trovi <a href="${privacyUrl}" style="color:#0a2540">chi siamo e quali diritti hai</a>.
    </p>`;
```

Poi agganciare i due frammenti a `text` e `html` (righe 652-664):

```ts
  const text =
    `Ciao ${p.nomeDestinatario},\n` +
    `${m.corpo}\n` +
    `Numero pratica: ${p.codicePratica}.` +
    agenziaText +
    privacyText;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">${escapeHtml(m.titolo)}</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeDestinatario)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">${escapeHtml(m.corpo)}</p>
    <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;font-size:13px;color:#0a2540">
      Numero pratica: <strong>${escapeHtml(p.codicePratica)}</strong>
    </div>${agenziaHtml}${privacyHtml}
  `);
  return { subject: m.subject, html, text };
```

**Nota sul nome della funzione di wrapping:** nel file la chiamata è `wrap(...)` (alias locale di `emailLayout`, importato alla riga 10). Non rinominarla.

- [ ] **Step 5: Passare il broker dal chiamante**

In `cliente.ts`, aggiungere alla `select` della pratica (dopo il blocco `veicoli`, riga 47):

```ts
        // Chi ci ha trasmesso i dati del cliente: serve nell'email AVVIATA per
        // l'informativa art. 14 GDPR ("da chi avete i miei dati?").
        broker: { select: { ragioneSociale: true } },
```

e al payload di `sendNotification` (dopo `agenziaProvincia`, riga 106):

```ts
            nomeBroker: pratica.broker?.ragioneSociale ?? null,
```

- [ ] **Step 6: Eseguire i test e verificare che PASSINO**

Run: `pnpm --filter piattaforma test -- templates`
Expected: PASS, tutti i test del describe N40 (compresi quelli preesistenti su agenzia/ruolo/veicolo null).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter piattaforma typecheck`
Expected: 0 errori. Se `pratica.broker` dà errore di tipo, la select dello Step 5 non è stata aggiunta o è finita nel posto sbagliato.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/lib/notifiche/templates.ts apps/piattaforma/src/lib/notifiche/cliente.ts apps/piattaforma/src/lib/notifiche/templates.test.ts
git commit -m "feat(notifiche): la N40 porta l'informativa art. 14 e dice al cliente da chi abbiamo i suoi dati"
```

---

### Task 6: Popup pre-invio — la garanzia resa nel momento del conferimento

La clausola 17.2 è una firma presa in registrazione. Il popup che il broker già conferma a **ogni** pratica (`BrokerDichiarazione` registra `popupVersion`, `ip`, `userAgent`) rende la stessa garanzia **nel momento esatto in cui i dati dei terzi ce li conferisce**. È ciò che rende la manleva della 17.5 azionabile.

**Files:**
- Modify: `apps/piattaforma/src/components/dichiarazione-popup.tsx` (lista righe 64-85, label righe 121-132)
- Modify: `apps/piattaforma/src/lib/penali/config.ts:40` (`POPUP_VERSION`)

**Interfaces:**
- Consumes: `PENALI.POPUP_VERSION` — già importato nel popup; già inviato al submit da `wizard.tsx:1608` (`fd.append('dichiarazionePopupVersion', PENALI.POPUP_VERSION)`) e persistito da `actions.ts:1652`. **Nessuna modifica al wizard o alla action:** la versione viaggia già da sola.
- Produces: `POPUP_VERSION = 'v3.0'`.

- [ ] **Step 1: Aggiungere la voce alla lista delle verifiche**

In `dichiarazione-popup.tsx`, aggiungere un quarto `<li>` in coda alla `<ul>` (dopo il `<li>` dei documenti autentici, riga 84):

```tsx
          <li className="flex items-start gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-pv-slate-400" />
            <span>
              Hai <strong>informato venditore e acquirente</strong> che i loro
              dati e documenti sono trasmessi a Passaggio Veloce per la gestione
              della pratica
            </span>
          </li>
```

- [ ] **Step 2: Estendere la label della checkbox**

La checkbox è la prova: deve coprire anche la nuova voce. Sostituire lo `<span>` della label (righe 128-131):

```tsx
          <span className="text-[13px] font-semibold text-pv-navy-800">
            Confermo di aver verificato quanto sopra, di aver informato
            venditore e acquirente sul trattamento dei loro dati (clausola 17
            dei Termini) e mi assumo piena responsabilità
          </span>
```

- [ ] **Step 3: Bump della versione del popup**

In `lib/penali/config.ts` riga 40:

```ts
  POPUP_VERSION: 'v3.0',
```

Il valore finisce in `BrokerDichiarazione.popupVersion`: senza il bump non sapremmo **quale testo** il broker ha confermato — che è tutto il punto di avere una prova.

- [ ] **Step 4: Test + typecheck**

Run: `pnpm --filter piattaforma test && pnpm --filter piattaforma typecheck`
Expected: PASS, 0 errori. (Se un test asseriva `'v2.0'` va aggiornato: `grep -rn "v2\.0" apps/piattaforma/src` per trovarlo.)

- [ ] **Step 5: Verifica nel browser col gesto utente (non saltabile)**

Il popup è un componente client con stato: navigare per URL non lo esercita. Serve il gesto.

1. `pnpm --filter piattaforma dev`, login come broker.
2. Crea una pratica fino all'ultimo step e clicca **Invia**.
3. Expected: il modale mostra **quattro** voci, la quarta è quella sui dati di venditore e acquirente; il bottone «Conferma e invia» è **disabilitato** finché non spunti la checkbox; la label della checkbox cita la clausola 17.
4. Spunta, conferma, e verifica che la pratica venga inviata senza errori.

- [ ] **Step 6: Verificare che la dichiarazione sia stata registrata con la versione nuova**

Sul DB locale:

```bash
docker exec -i pv-postgres psql -U postgres -d passaggio_veloce -c "SELECT \"popupVersion\", \"praticaId\", \"createdAt\" FROM broker_dichiarazioni ORDER BY \"createdAt\" DESC LIMIT 3;"
```

Expected: la riga più recente (la pratica appena inviata) ha `popupVersion = v3.0`. Se ha ancora `v2.0`, il valore non arriva al backend — indagare `wizard.tsx:1608`.

> Se il nome del container o del database differiscono, ricavarli da `docker ps` e da `DATABASE_URL` in `.env`. Il punto della verifica non è il comando: è che la versione nuova sia davvero **persistita**, non solo renderizzata.

- [ ] **Step 7: Commit**

```bash
git add apps/piattaforma/src/components/dichiarazione-popup.tsx apps/piattaforma/src/lib/penali/config.ts
git commit -m "feat(pratiche): il broker dichiara a ogni invio di aver informato venditore e acquirente"
```

---

### Task 7: Verifica finale e allineamento della documentazione

**Files:**
- Modify: `docs/funzionalita-implementate.md` (riga da aggiungere in coda alla tabella)
- Verify (non modificare): `apps/piattaforma/src/lib/providers/chatbot/kb/kb.generated.ts`

**Interfaces:**
- Consumes: tutti i task precedenti.
- Produces: niente.

- [ ] **Step 1: Verificare che la KB del chatbot non sia diventata stale**

`scripts/build-chatbot-kb.ts` legge **solo i `.md` di primo livello di `docs/`** (`readdirSync` non ricorsivo): la spec e il piano, che stanno in `docs/superpowers/`, non ci finiscono. I numeri di clausola citati nei `docs/*.md` sono tutti ≤ 12, quindi **sotto** la fascia rinumerata. Verificalo invece di fidarti:

Run: `grep -rn "clausola 1[3-9]\|clausole 1[3-9]" docs/*.md`
Expected: **nessun match**. Se ne compare uno, quel doc cita un numero che la rinumerazione ha reso falso: correggilo e poi rigenera la KB con `pnpm --filter piattaforma kb:build`, committando `kb.generated.ts`.

- [ ] **Step 2: Suite completa**

Run: `pnpm --filter piattaforma test && pnpm --filter piattaforma typecheck && pnpm --filter piattaforma lint`
Expected: tutti verdi, 0 errori.

> Se `typecheck` esplode con stack overflow o errori Prisma assurdi, è la cache fredda: gira una `pnpm --filter piattaforma build` (o un typecheck precedente andato a buon fine) per rigenerare il `tsbuildinfo`, poi rilancia. Non è un errore vero del codice.

- [ ] **Step 3: Giro completo nel browser**

Con `pnpm --filter piattaforma dev`:

1. `/termini` → la clausola 17 c'è, il foro è la 18, l'approvazione specifica è la **19** ed elenca `3, 5, 7, 8, 10, 11, 12, 13, 17, 18`. Il link nella 16 e nella 17.3 porta a `/privacy/clienti`.
2. `/privacy/clienti` → renderizza, tutti i link funzionano.
3. `/privacy` → nessuna traccia di Cloudflare R2; il rinvio ai clienti finali funziona.
4. `/register` → step 4: la checkbox delle vessatorie elenca `3, 5, 7, 8, 10, 11, 12, 13, 17, 18` (viene dalla fonte unica: se mostra ancora la lista vecchia, il bundle è stale — riavvia il dev server).

- [ ] **Step 4: Verificare l'email N40 su un invio vero**

Invia una pratica di test e controlla l'email `AVVIATA` recapitata (in dev: log del provider email o Resend in modalità test).
Expected: contiene il link a `/privacy/clienti` **e** la frase «I tuoi dati ci sono stati trasmessi da *«ragione sociale del broker»*». Se il nome del broker manca, la `select` del Task 5 Step 5 non sta arrivando al template.

- [ ] **Step 5: Aggiornare `docs/funzionalita-implementate.md`**

Aggiungere in coda alla tabella delle funzionalità:

```markdown
| — | **Copertura GDPR dati di terzi** | **Fatto (2026-07-14)**: PV **titolare autonomo** dei dati di venditore/acquirente (non responsabile ex art. 28 — determiniamo noi provider OCR, retention e antifrode). Termini: nuova **clausola 17** (garanzia + manleva, vessatoria; foro → 18, approvazione specifica → 19). Nuova informativa **art. 14** su `/privacy/clienti`, recapitata dalla mail **N40** che ora dice anche **da chi** abbiamo ricevuto i dati. `/privacy` corretta (Vercel Blob, non R2; permesso di soggiorno e certificato di morte dichiarati; retention veritiera). Il popup pre-invio raccoglie la garanzia a ogni pratica (`popupVersion` → `v3.0`). ⚠️ **DRAFT: da sottoporre a revisione legale prima del go-live.** Spec: `superpowers/specs/2026-07-14-gdpr-dati-terzi-design.md` | — | — |
```

- [ ] **Step 6: Rigenerare la KB (il doc di primo livello è cambiato)**

Run: `pnpm --filter piattaforma kb:build`
Expected: `KB generata → public=… clients=… internal=… char`.

- [ ] **Step 7: Commit finale**

```bash
git add docs/funzionalita-implementate.md apps/piattaforma/src/lib/providers/chatbot/kb/kb.generated.ts
git commit -m "docs(gdpr): registra la copertura dei dati di terzi tra le funzionalità implementate"
```

---

## Cosa NON fa questo piano (dichiarato)

- **Nessuna migration**, nessun backfill, nessuna riaccettazione retroattiva dei già registrati: non siamo online, i dati attuali sono di test e il DB verrà ripulito.
- Nessun job di cancellazione delle pratiche concluse a scadenza fiscale: il testo della privacy viene reso veritiero **senza** promettere un job che non esiste.
- Nessuna DPIA, nessun registro dei trattamenti (art. 30), nessuna raccolta dei contratti di nomina verso Google/Resend/Vercel/Neon: sono documenti, non codice.
- **La qualificazione resta la decisione del legale.** Se sceglie contitolarità (art. 26) o responsabile (art. 28), cambiano la clausola 17 e l'intestazione dell'informativa. L'impianto tecnico — pagina, link nelle email, prova per-pratica — regge in tutti e tre gli scenari.
