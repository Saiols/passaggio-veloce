# Feedback di caricamento ovunque — Design

Data: 2026-06-12
Autore: Francesco Sioli (CTO) + Claude
Stato: approvato

## Problema

Al click sui bottoni che scatenano azioni che richiedono tempo (es. avanzamento
stato pratica: "Pratica processata", "Firma avvenuta", "Annulla pratica"), spesso
non c'è alcun segnale che il sistema stia lavorando. L'utente non capisce se il
click sia andato a buon fine o meno. In alcuni punti il feedback è già gestito
(bottone disabilitato + spinner, oppure `useTransition` isPending), in altri no.

Obiettivo: **ovunque** ci sia una Server Action / chiamata che può richiedere
tempo, mostrare un feedback di caricamento visibile (spinner inline + bottone
disabilitato), in modo coerente con il pattern già esistente.

## Decisioni (approvate)

1. **Ampiezza**: sweep completo di tutti i buchi, diviso in commit logici per area.
2. **Nessuna barra di avanzamento globale**: solo spinner sui singoli bottoni/azioni.
3. **Feedback inline** sul bottone (disabilitato + spinner + label tipo "Invio in
   corso…"). Nessun overlay a schermo, nemmeno per le azioni critiche/irreversibili.

## Contesto tecnico rilevato

- Esiste già `Button` (`apps/piattaforma/src/components/ui/button.tsx`) con prop
  `loading` / `loadingLabel`: quando `loading=true` disabilita il bottone, mostra
  uno spinner SVG (`animate-spin`), sostituisce il testo con `loadingLabel`
  (default "Attendi…"), imposta `cursor-wait` e `aria-busy`. È il mattone su cui
  standardizzare.
- **Tutte le mutazioni sono Next.js Server Actions** — nessuna chiamata `fetch`
  client nei componenti. Quindi i meccanismi in gioco sono solo due:
  - `useFormStatus()` per i `<form action={serverAction}>`;
  - `useTransition()` + `isPending` per gli onClick che invocano una action.
- Pattern "buoni" già presenti da imitare:
  - `apps/piattaforma/src/app/pratiche/[id]/valutazione-form.tsx` (useTransition +
    `loading={isPending}` + `loadingLabel`).
  - `apps/piattaforma/src/app/pratiche/[id]/segnala-button.tsx`.
  - `apps/piattaforma/src/components/company-edit-form.tsx`.
  - `apps/piattaforma/src/app/profilo/sicurezza/client.tsx`.

## Architettura della soluzione

### 1. Nuovo componente `SubmitButton`

File: `apps/piattaforma/src/components/ui/submit-button.tsx` (client component).

Legge `useFormStatus()` e renderizza il `Button` esistente con `loading={pending}`.
Deve essere un componente separato perché `useFormStatus` funziona solo dentro un
`<form>` e legge lo stato del form padre.

API: stesse props di `Button` (variant, size, loadingLabel, ecc.). `type="submit"`
di default. Drop-in replacement: dentro un `<form action={…}>` si sostituisce
`<Button type="submit">…</Button>` con `<SubmitButton>…</SubmitButton>`.

Esportato da `apps/piattaforma/src/components/ui/index.ts`.

Comportamento: quando il form è in submit (action in corso), `pending` diventa
`true` → spinner + disabilitato + `loadingLabel`. Si chiude automaticamente al
completamento o alla navigazione (redirect).

### 2. Tre categorie di fix (sweep completo)

**Categoria A — Form-action buttons** (`<form action={serverAction}>` senza stato
client). Include il buco principale (avanzamento pratica). Fix: swap a
`<SubmitButton>` con `loadingLabel` adeguata.
- `apps/piattaforma/src/app/pratiche/[id]/page.tsx`: "Pratica processata",
  "Firma avvenuta", "Annulla pratica".
- Altri form-action analoghi individuati durante lo sweep (~8 punti totali).

**Categoria B — `disabled={pending}` senza `loading`** (onClick + useTransition
che disabilitano ma non mostrano spinner). Fix: aggiungere `loading={pending}` +
`loadingLabel`.
- `apps/piattaforma/src/app/profilo/personale/form.tsx`
- `apps/piattaforma/src/app/profilo/listino/client.tsx`
- ~35 file analoghi.

**Categoria C — Bottoni custom con solo "…"/cambio testo** (markup custom, non
usano `Button`). Fix: convertire a `Button`/`SubmitButton` dove pulito; dove il
restyle è rischioso (es. pill compatta nella lista) iniettare uno spinner inline
minimale mantenendo il markup e la classe.
- `apps/piattaforma/src/app/pratiche/quick-action-button.tsx`
- `apps/piattaforma/src/app/admin/suspend-button.tsx`
- `apps/piattaforma/src/app/admin/companies/[id]/delete-button.tsx`
- `apps/piattaforma/src/app/admin/escalation/assign-form.tsx`
- ~20 file analoghi (admin, wallet, codici-promozionali, …).

### 3. Convenzione `loadingLabel` (italiano)

Coerente in tutta l'app, scelta in base al verbo dell'azione:
- Salvataggio dati → "Salvataggio…"
- Invio (form, segnalazione, valutazione) → "Invio in corso…"
- Eliminazione → "Eliminazione…"
- Aggiornamento/modifica stato → "Aggiornamento…"
- Conferma azione → "Conferma in corso…"
- Annullamento → "Annullamento…"

## Fuori scope

- `<a href>` di download PDF (es. "Scarica PDF" in `pratiche/[id]/page.tsx`):
  navigazione browser, non bloccante JS. Segnalato, non modificato.
- Flussi upload/scanner documenti: hanno già il proprio feedback di caricamento.
- Nessuno skeleton/placeholder di pagina (fuori dallo scope di questa iterazione,
  che riguarda i feedback delle azioni).

## Data flow / error handling

Nessun cambiamento di logica. Le Server Action restano invariate (redirect /
`router.refresh()` / throw). Il feedback è puramente presentazionale.
`useFormStatus` legge il pending del form padre; `useTransition` resetta `isPending`
al completamento. In caso di errore con redirect, lo stato si chiude alla
navigazione/refresh come oggi.

## Testing

- `typecheck` + `build` del monorepo verdi.
- Smoke test del nuovo `SubmitButton` (mostra loading quando il form è pending),
  se è presente setup di test componenti; altrimenti verifica manuale.
- Verifica manuale del flusso pratica end-of-phase: ogni bottone di avanzamento
  mostra spinner + disabilitazione al click.
- I singoli swap presentazionali (categorie B/C) non richiedono unit test dedicati.

## Piano commit (logici per area)

1. **infra**: `SubmitButton` + export da `ui/index.ts`.
2. **pratiche** (buco principale): dettaglio (`pratiche/[id]/page.tsx`) + lista
   (`quick-action-button.tsx`).
3. **profilo / team / wallet**.
4. **admin**.
5. **registrazione / residui**.
