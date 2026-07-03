# Stato segnalazione/annullamento visibile al broker (e agenzia) — Design

> Data: 2026-07-03 · Owner: CTO Francesco Sioli
> Contesto: [Sistema Penali Broker](../../sistema-penali-broker.md).

## Problema

1. Quando l'agenzia **segnala** una pratica (`flagSegnalata=true`, `segnalazioneStato='RICEVUTA'`),
   il broker continua a vedere lo stato grezzo (`ACCETTATA`/`PROCESSATA`) senza alcun
   indizio che è in revisione.
2. Quando l'admin **conferma** la segnalazione la pratica passa a `ANNULLATA`, ma il
   broker vede solo "Annullata" (grigio) senza saperne il motivo.

Tutti i dati necessari esistono già sul modello `Pratica` e sono già restituiti dalle
query di lista (`include`, nessun `select` che restringa gli scalari) e di dettaglio.
Quindi il lavoro è **solo di presentazione** + un piccolo modulo puro di rilevamento.
Nessuna migration, nessuna modifica alle server action.

## Decisioni prese (con l'utente)

- **#1 in lista**: si **mantiene** il chip `Accettata/Processata` e si affianca una **pill
  rossa `⚠ Segnalata`** con icona ⓘ → modale. (Non si sostituisce la label.)
- **Dettaglio revisione**: il modale **rivela il tipo** segnalato con caveat
  *"(in verifica dal team)"*.
- **#2 rosso + motivo**: **solo** per annullamenti guidati dal team (segnalazione confermata
  o revisione documentale del team). L'**auto-annullo del broker** resta grigio, senza ⓘ.
- **Ambito**: trattamento applicato **sia al broker sia all'agenzia**.
- Micro-default approvati: mostrare la **nota agenzia** nei modali; nel modale annullata da
  segnalazione aggiungere una riga sulla **penale** (se `penaleAddebitatoCent` valorizzato).

## Origini di `ANNULLATA` (3) e discriminazione

| Origine | Come si riconosce (campi esistenti) | Trattamento |
|---|---|---|
| Segnalazione confermata | `stato='ANNULLATA' && segnalazioneStato='CONFERMATA'` | rosso + motivo = `tipoSegnalazione` (+ nota, + penale) |
| Revisione documentale team | `stato='ANNULLATA' && revisioneCompletata && richiedeRevisioneManuale` | rosso + motivo generico "revisione documentale" |
| Auto-annullo broker | tutto il resto con `stato='ANNULLATA'` | grigio, nessuna ⓘ |

> Nota: chiusura revisione come `RISOLTA` imposta `richiedeRevisioneManuale=false`; come
> `ANNULLATA` lo lascia `true` e imposta `stato='ANNULLATA'`. Quindi
> `revisioneCompletata && richiedeRevisioneManuale` distingue l'annullo-da-revisione da una
> pratica revisionata-e-risolta poi auto-annullata dal broker.

## Componenti

### A. Modulo puro `lib/pratiche/stato-extra.ts` (+ test)

```ts
type StatoExtra =
  | { kind: 'IN_REVISIONE'; tipo: SegnalazioneTipo | null; nota: string | null }
  | { kind: 'ANNULLATA_TEAM'; origine: 'SEGNALAZIONE'; tipo: SegnalazioneTipo | null;
      nota: string | null; penaleCent: number | null }
  | { kind: 'ANNULLATA_TEAM'; origine: 'REVISIONE' }
  | null;

function statoExtra(p: StatoExtraInput): StatoExtra
function tipoSegnalazioneLabel(t: SegnalazioneTipo): string
```

`tipoSegnalazioneLabel`: `FERMO_AMMINISTRATIVO→"Fermo amministrativo"`, `IPOTECA→"Ipoteca"`,
`DOCUMENTO_NON_VALIDO→"Documento non valido"`, `ALTRO→"Altro"`.

Input = sottoinsieme dei campi Pratica: `stato, flagSegnalata, segnalazioneStato,
tipoSegnalazione, notaSegnalazione, penaleAddebitatoCent, revisioneCompletata,
richiedeRevisioneManuale`.

### B. `components/ui/status-chip.tsx` — prop `tone?: 'danger'`

Quando valorizzato sovrascrive la palette a rossa (`bg-pv-red-50 text-pv-red-500`, già usata
per `SCADUTA`). Il server passa `tone='danger'` sse `statoExtra?.kind === 'ANNULLATA_TEAM'`.

### C. Client component `app/pratiche/stato-extra-info.tsx`

Riceve `StatoExtra` (già calcolato dal server) e rende:
- `IN_REVISIONE` → pill `⚠ Segnalata` + ⓘ → `Modal` "Pratica in revisione": anomalia + tipo
  + "(in verifica dal team)" + eventuale nota agenzia + "Ti aggiorneremo a verifica conclusa."
- `ANNULLATA_TEAM/SEGNALAZIONE` → ⓘ → `Modal` "Pratica annullata": **"Motivo: {tipo}"** +
  eventuale nota + (se penale) riga penale.
- `ANNULLATA_TEAM/REVISIONE` → ⓘ → `Modal`: "Annullata dal team a seguito della revisione
  documentale."
- `null` → non rende nulla.

Riusa la primitiva `Modal` (`components/ui/modal.tsx`).

### D/E. Integrazione

- **Lista** `app/pratiche/page.tsx`: nella cella stato, `statoExtra(p)` (server) →
  `<StatusChip tone=…/> <StatoExtraInfo …/>`. Campi già in query.
- **Dettaglio** `app/pratiche/[id]/page.tsx`: stessa coppia nell'header stato. `pratica` ha
  già tutti i campi.

Entrambe le viste valgono per broker e agenzia.

### F. Test

Unit test del modulo puro: tutte le branch (in-revisione, annullata-segnalazione,
annullata-revisione, auto-annullo→null, RESPINTA→null, mancanza campi). Nessuna modifica a
server action o schema.

## Non-obiettivi

- Nessuna modifica al flusso di segnalazione/conferma/penale (già in prod).
- Nessun nuovo campo su `Pratica` (si inferisce dai campi esistenti).
- Nessun cambiamento alle notifiche email (N17/N18/N19/N21 restano).
