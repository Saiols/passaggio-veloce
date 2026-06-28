# Loading a tutto schermo al cambio sede — Design

**Data:** 2026-06-28
**Branch:** main
**Stato:** approvato (design confermato dall'utente)

## Obiettivo

Al cambio di sede operativa (sia per **agenzia** sia per **broker**) mostrare un
**loading a tutto schermo** visibile, che blocca l'interazione, finché i dati
non sono aggiornati con il nuovo scoping di sede.

## Contesto esistente

- Selettore condiviso: `apps/piattaforma/src/components/sede/sede-switcher-client.tsx`
  (`SedeSwitcherClient`, client component). Wrappato dal server component
  `SedeSwitcher`, renderizzato in `app-shell.tsx` (la shell condivisa
  broker+agenzia) sia nel layout desktop sia in quello mobile. **Un'unica
  modifica al client component copre entrambi i ruoli e tutti i punti.**
- Flusso attuale al cambio: `onChange` del `<select>` apre una `useTransition`
  che chiama `setCurrentSedeAction(v)` (scrive il cookie `pv_sede`) e poi
  `router.refresh()` (ri-render dei server component con il nuovo scoping).
- Feedback attuale: solo il `<select>` `disabled` (opacizzato). Nessun loading
  visibile a schermo.
- Il flag `pending` di `useTransition` resta `true` esattamente dall'inizio del
  cambio finché l'azione **e** il `router.refresh()` non hanno committato il
  nuovo render → è il segnale corretto per "dati non ancora aggiornati".
- Spinner riusabile già presente: `components/ui/inline-spinner.tsx`
  (`InlineSpinner`, prop `className`).

## Architettura

Agganciare un overlay full-screen al flag `pending` già esistente. Nessun
nuovo stato, nessun context: si riusa il `pending` della transizione.

### Componenti

1. **`SedeSwitchOverlay`** — nuovo componente presentazionale
   `apps/piattaforma/src/components/sede/sede-switch-overlay.tsx`.
   - Prop: `{ show: boolean }`.
   - Quando `show === false` → ritorna `null`.
   - Quando `show === true` → via `createPortal` su `document.body` renderizza
     un `fixed inset-0` a tutto schermo:
     - backdrop semiopaco con blur (`bg-white/70 backdrop-blur-sm`),
     - contenuto centrato: `InlineSpinner` (ingrandito via `className`) + testo
       **"Aggiornamento sede…"** in `pv-navy`,
     - `z` molto alto (sopra sidebar e modali),
     - blocca i click (copre il viewport),
     - `role="status"` + `aria-busy="true"` per accessibilità.
   - `createPortal` su `document.body`: garantisce il full-screen reale
     indipendentemente dallo stacking context dell'header che contiene il
     selettore. Guardia SSR: render solo lato client (il componente è dentro un
     `'use client'`; `document` è disponibile al render perché l'overlay appare
     solo dopo un'interazione utente — comunque guardia `typeof document` per
     sicurezza).

2. **`SedeSwitcherClient`** (modifica) — renderizza
   `<SedeSwitchOverlay show={pending} />` accanto al `<select>` esistente. Il
   `<select>` resta `disabled={pending}` come ora.

## Dati / flusso

Invariato. `onChange → startTransition(setCurrentSedeAction → router.refresh)`.
L'overlay è puramente derivato da `pending`; compare all'inizio della
transizione e sparisce quando il nuovo render è committato.

## Edge cases

- **Refresh velocissimo:** l'overlay può lampeggiare per una frazione di
  secondo. Accettato (è esattamente il "loading visibile" richiesto). Nessun
  ritardo anti-flash di default (YAGNI); aggiungibile in seguito se richiesto.
- **Errore di `setCurrentSedeAction`** (es. sede non accessibile): la
  transizione termina comunque, `pending` torna `false`, l'overlay sparisce. Il
  comportamento d'errore resta quello attuale (nessun cambio); fuori scope.

## Test

- Unit sul presentational `SedeSwitchOverlay` (collocazione co-locata, come gli
  altri test componente del repo):
  - `show={true}` → rende il testo "Aggiornamento sede…" e `role="status"`;
  - `show={false}` → non rende nulla.

## File toccati

- `apps/piattaforma/src/components/sede/sede-switch-overlay.tsx` — **nuovo** presentational + test
- `apps/piattaforma/src/components/sede/sede-switcher-client.tsx` — render dell'overlay su `pending`
