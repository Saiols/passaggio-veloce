# Email di partenza CRM — testo del messaggio editabile

Data: 2026-07-17
Stato: approvato, in implementazione

## Contesto

La feature "Email di partenza CRM" (in prod dal 2026-07-15) invia a un lead
broker/agenzia un'email a freddo con link di registrazione `/i/<token>` e un
eventuale codice welcome precompilato. Il modale `EmailPartenzaModal`
(`apps/piattaforma/src/app/admin/crm/contatti/client.tsx`) oggi lascia
modificare solo **Nome referente** e **Codice welcome**; l'intero corpo del
messaggio è hardcoded in `tplN26EmailPartenza`
(`apps/piattaforma/src/lib/notifiche/templates.ts`).

## Obiettivo

Aggiungere una **textarea** col messaggio precompilato (diverso per
Broker/Agenzia), modificabile **ad-hoc** prima del singolo invio. Nessuna
persistenza: ogni invio riparte dal testo predefinito.

## Decisioni (brainstorming)

- **Cosa è editabile**: solo il messaggio (i paragrafi introduttivi tra il
  saluto e il pulsante CTA). Restano fissi e garantiti: saluto, pulsante CTA,
  checklist documenti, box codice welcome, footer disiscrizione, layout
  istituzionale.
- **Testo predefinito**: precompilato ad-hoc, category-aware, non persistito.
  Nessuna nuova tabella, nessuna pagina impostazioni.
- **Trade-off accettato**: il messaggio diventa testo libero → la ragione
  sociale nel primo paragrafo **non è più in grassetto** (oggi `<strong>`).
  Niente sistema di segnaposto/markup (YAGNI).
- **Textarea libera**: nessun vincolo di formattazione oltre l'escaping HTML e
  un limite di lunghezza (4000 caratteri).

## Design

### 1. Fonte unica del default — `lib/crm/email-partenza.ts`

Nuova funzione pura:

```ts
defaultMessaggioPartenza({ categoria, ragioneSociale }): string
```

Ritorna il testo attuale in plain-text:

```
come d'accordo nella nostra telefonata, ecco il link per attivare {ragioneSociale} su Passaggio Veloce. Bastano circa 5 minuti.

{contesto}
```

dove `{contesto}` è:
- BROKER: "Carichi la pratica in 2 minuti, un'agenzia della tua zona la prende
  in carico e la segui in tempo reale."
- AGENZIA: "Ricevi pratiche già complete e verificate dalla tua provincia, e
  decidi tu quali accettare."

Importabile sia dal client (pre-fill) sia dal template/test → un solo posto di
verità per il default.

### 2. Client — `EmailPartenzaModal`

- Nuovo stato `messaggio`, inizializzato con
  `defaultMessaggioPartenza({ categoria: contact.cat, ragioneSociale: contact.nome })`.
- Textarea (~6 righe) sotto "Nome referente".
- Invio bloccato se `messaggio.trim()` è vuoto (come già per `nomeReferente`).
- Passa `messaggio` a `sendEmailPartenzaAction`.

### 3. Action — `sendEmailPartenzaAction`

- Nuovo campo di input `messaggio`, validato: `trim().min(1).max(4000)`.
- Inoltrato nel payload `N26_EMAIL_PARTENZA`.

### 4. Template — `tplN26EmailPartenza`

- Payload: rimuovere `ragioneSociale`; aggiungere `messaggio: string`. Tenere
  `categoria` (serve per l'etichetta del pulsante CTA e il testo alternativo).
- Il messaggio rende al posto dei due paragrafi fissi:
  - **HTML**: `escapeHtml` → riga vuota (`\n\n`) = nuovo `<p>`, singolo `\n` =
    `<br>`. XSS-safe.
  - **Text**: messaggio in chiaro.
- Invariato: saluto `Buongiorno {nomeReferente}`, CTA, checklist, box codice,
  footer disiscrizione, layout.

### 5. Test

- `lib/crm/email-partenza`: test per `defaultMessaggioPartenza` (BROKER/AGENZIA).
- `templates.test.ts`: nuova firma payload; verifica che il messaggio custom
  compaia e che HTML pericoloso venga escapato.
- `email-partenza.action.test.ts`: il campo `messaggio` viene validato e passato
  al payload.

## Note

- `escapeHtml` già esistente nel modulo template; riuso quello.
- Nessuna migration DB.
- Verifica finale nel browser (area CRM gated → login admin CRM), oltre a
  typecheck + unit test.
