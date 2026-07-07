# Termini e Condizioni completi + doppia accettazione

> Spec di design — 2026-07-07
> Stato: APPROVATA (design). Owner: Francesco Sioli (CTO).
> ⚠️ Contenuto legale: richiede revisione di un avvocato prima del go-live (in particolare la
> clausola 3 — variazione prezzo illimitata — e le manleve/limitazioni di responsabilità).

## 1. Contesto

Oggi `/termini` (`apps/piattaforma/src/app/termini/page.tsx`) è un boilerplate generico di 8
sezioni, esplicitamente marcato "in attesa di revisione legale". In registrazione (step 4,
`register-wizard.tsx`) c'è **un solo** checkbox `termsAccepted` (Zod `z.literal(true)` in
`lib/auth/schemas.ts`; persistito come `Company.termsAcceptedAt`). Va sostituito con un T&C
completo che copra i meccanismi economici reali della piattaforma, con accettazione conforme
all'art. 1341/1342 c.c.

## 2. Decisioni (approvate con l'utente)

- **D1** — Riscrittura completa di `/termini` con 17 clausole numerate (dettaglio §3).
- **D2 — Doppia accettazione**: in registrazione si aggiunge un **secondo checkbox** obbligatorio
  che approva **specificamente** le clausole vessatorie ex artt. 1341-1342 c.c., elencandone i numeri.
- **D3 — Variazione prezzo**: clausola 3 scritta **come richiesto** ("a nostra discrezione, senza
  limitazioni", range 1-200 €/pratica), resa opponibile dalla doppia accettazione D2.
- **D4** — Includere anche **penali broker** e **mandato SEPA** come clausole (meccanismi reali).
- **D5 — Recesso**: contratto a tempo indeterminato, recesso libero con preavviso 30 gg via email.
- **Nessuna migration**: i checkbox sono gate del form; l'accettazione resta timestampata da
  `Company.termsAcceptedAt`. (Follow-up opzionale: colonna dedicata + versione T&C per prova
  rafforzata — richiede migration, fuori scope qui.)

## 3. Struttura dei Termini (17 clausole)

Numerate (serve per il richiamo delle vessatorie). Le voci *(vessatoria)* confluiscono
nell'elenco di approvazione specifica (clausola 17).

1. Definizioni e oggetto — PV piattaforma B2B di intermediazione; non è parte della pratica.
2. Registrazione, account e KYC — veridicità dati, verifica documenti, account/sedi.
3. **Prezzo del servizio (fee agenzia)** — corrispettivo variabile **1-200 €** per pratica
   **accettata** via piattaforma; PV può variarlo a propria discrezione, senza limitazioni. *(vessatoria)*
4. **Programma di affiliazione** — **1-10 €** per pratica, dovuta **solo a pratica firmata** da
   utenti registrati con referral; se i referral sono **due** (broker + agenzia) la commissione è
   **divisa** tra i due referenti; accredito su wallet; anti-collusione.
5. **Wallet e payout** — accredito alla firma; **prelievo solo al raggiungimento di 500 €**;
   payout automatico alla soglia configurata (default 1.000 €, range 1.000-5.000 €); erogazione via
   bonifico su IBAN; saldo negativo/penali. *(vessatoria — condizioni di prelievo)*
6. **Fatturazione conto terzi (delegata)** — l'utente conferisce mandato a PV a emettere fatture
   per suo conto; accettazione del meccanismo.
7. **Regime fiscale e prezzo differenziato** — trattamento diverso per aziende / ditte individuali /
   ditte individuali forfettarie; per le **forfettarie** trattenimento della differenza IVA ed
   erogazione inferiore. *(vessatoria)*
8. **Visura camerale — aggiornamento, responsabilità e manleva** — obbligo dell'utente di mantenere
   aggiornata la visura; manleva a favore di PV per la corretta gestione della fatturazione (anche
   conto terzi). *(vessatoria)*
9. **Mandato SEPA** (agenzie) — addebito diretto per le fee.
10. **Sistema penali** — segnalazioni e penale broker. *(vessatoria)*
11. **Sospensione, anti-abuso e cancellazione**. *(vessatoria)*
12. **Limitazioni di responsabilità**. *(vessatoria)*
13. **Modifiche ai termini** — preavviso 30 gg, riaccettazione per modifiche sostanziali.
14. **Recesso** — tempo indeterminato, recesso libero con preavviso 30 gg via email.
15. **Trattamento dei dati personali (GDPR)** — rimando all'Informativa Privacy.
16. **Legge applicabile e foro competente**. *(vessatoria)*
17. **Approvazione specifica ex artt. 1341-1342 c.c.** — elenco: clausole **3, 5, 7, 8, 10, 11, 12, 16**.

Mantiene: intestazione, "Ultimo aggiornamento" aggiornata, disclaimer di revisione legale.

## 4. Registrazione (step 4)

File: `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx`, `lib/auth/schemas.ts`.

- Resta il 1° checkbox `termsAccepted` ("Ho letto e accetto i Termini e Condizioni e l'Informativa
  Privacy…").
- **Nuovo 2° checkbox** `clausoleVessatorieAccepted` (obbligatorio): *"Ai sensi degli artt.
  1341-1342 c.c. approvo specificamente le clausole nn. 3, 5, 7, 8, 10, 11, 12, 16 dei Termini e
  Condizioni (prezzo del servizio e sue variazioni, condizioni di prelievo, regime fiscale e
  trattenute, manleva sull'aggiornamento visura, penali, sospensione, limitazioni di
  responsabilità, foro competente)."*
- Zod: `clausoleVessatorieAccepted: z.literal(true, { message: 'Devi approvare specificamente le clausole indicate' })`.
- Il link "Termini e Condizioni" continua a puntare a `/termini`.

## 5. Testing
- Unit: lo schema di registrazione **rifiuta** se `clausoleVessatorieAccepted !== true` (e continua
  a richiedere `termsAccepted`).
- Typecheck, lint, build (la pagina `/termini` è statica → prerender OK).
- Verifica manuale: registrazione bloccata finché entrambi i checkbox non sono spuntati; pagina
  `/termini` leggibile.

## 6. Fuori scope
- Colonna DB dedicata all'accettazione vessatorie + versionamento T&C (follow-up con migration).
- Testo definitivo validato dal legale (questo è un draft tecnico completo, da rivedere).
- Riaccettazione retroattiva degli utenti già registrati (gestita dalla clausola 13 alla prossima
  modifica sostanziale).
