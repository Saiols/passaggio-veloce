# Chiarezza degli step (B2) — Guida prossimo passo + toast — Design

Data: 2026-06-14
Autore: Francesco Sioli (CTO) + Claude
Stato: approvato (mockup validato via visual companion)

## Problema / obiettivo

Rendere evidente, in ogni momento, **cosa fare ora / cosa sta succedendo** nel
flusso pratica: l'utente (broker o agenzia) non deve indovinare il prossimo
passo. Tre leve: una **guida "prossimo step"** sul dettaglio pratica, **toast** di
conferma dopo le azioni, e **hint leggeri** dove serve (inbox/dashboard).

## Decisioni approvate (look validato)

- **Stile**: stepper del ciclo in cima + **card con barra arancione a sinistra**;
  CTA **pulsante** quando l'azione è dell'utente; variante **grigia "in attesa"**
  (senza CTA) quando la palla è all'altra parte.
- **Toast**: sì, conferme dopo le azioni del flusso pratica.
- **Superfici**: dove ha senso → dettaglio pratica (core) + inbox + dashboard
  (hint leggeri).

## Contesto tecnico

- `PraticaStato`: `BOZZA`, `IN_ATTESA_ROUND_1/2/3`, `IN_ESCALATION`, `ACCETTATA`,
  `PROCESSATA`, `FIRMATA`, `SCADUTA`, `ANNULLATA`.
- Dettaglio pratica `app/pratiche/[id]/page.tsx`: header + riga azioni
  (`processataBound`/`firmaBound`/`annullaBound` come `<form>` con `SubmitButton`,
  `ValutazioneForm`, `SegnalaProblemaButton`) + banner da `searchParams`
  (`sp.firmata`, `sp.processata`, `sp.annullata`, `sp.error`). Flag già calcolati:
  `canProcessata`, `canFirma`, `canAnnulla`, `canValutare`, `canSegnalare`.
- `StatusChip` mappa già `PraticaStato`→label per ruolo (riusare le label).
- Nessun sistema di toast oggi; i feedback passano da `?param` → `Alert` banner.
- Viewer: `companyType` 'DEALER' (broker) / 'AGENZIA'; admin/assistente → vista
  neutra (nessuna CTA).

## Architettura

### Parte 1 — Guida "prossimo step" (dettaglio pratica)

**1a. Funzione pura** `lib/pratiche/guida-step.ts`:
```
type StepKey = 'inviata' | 'accettata' | 'processata' | 'firmata';
type GuidaVariant = 'azione' | 'attesa' | 'chiusa';
type GuidaCta = 'processata' | 'firma' | 'annulla' | 'valuta' | null;
type GuidaStep = {
  steps: { key: StepKey; label: string; stato: 'done'|'current'|'todo' }[];
  variant: GuidaVariant;
  titolo: string;
  descrizione: string;
  cta: GuidaCta;            // quale azione primaria evidenziare (null se attesa/chiusa)
  chiusaNegativa?: boolean; // SCADUTA/ANNULLATA → tono rosso/grigio
};
export function guidaStep(input: {
  stato: PraticaStato;
  ruolo: 'DEALER' | 'AGENZIA' | 'ALTRO';
  hasValutazione: boolean;
}): GuidaStep
```
Mapping (stato × ruolo):
| stato | broker (DEALER) | agenzia (AGENZIA) |
|---|---|---|
| IN_ATTESA_*/IN_ESCALATION | attesa "In attesa che un'agenzia accetti" | attesa (raro qui) |
| ACCETTATA | attesa "L'agenzia sta lavorando la pratica" | **azione** "Lavora e segna 'Pratica processata'" · cta=processata |
| PROCESSATA | attesa "In attesa della firma del cliente" | **azione** "Segna la firma avvenuta" · cta=firma |
| FIRMATA + !valutazione | **azione** "Valuta l'agenzia" · cta=valuta | chiusa "Pratica completata e firmata" |
| FIRMATA + valutazione | chiusa "Pratica completata e valutata" | chiusa "Pratica completata" |
| SCADUTA | chiusa negativa "Nessuna agenzia ha accettato in tempo" | idem |
| ANNULLATA | chiusa negativa "Pratica annullata" | idem |
| BOZZA | chiusa "Bozza" | chiusa "Bozza" |
Steps (sempre 4: Inviata→Accettata→Processata→Firmata), `done/current/todo`
derivati dallo stato; per gli stati IN_ATTESA il corrente è "Accettata" in
pending con label "In attesa agenzia". Admin/assistente (`ruolo='ALTRO'`):
variant 'attesa'/'chiusa', mai 'azione' (nessuna CTA).

**1b. Componente presentazionale** `app/pratiche/[id]/guida-step.tsx` (server
component): riceve `guida: GuidaStep` e uno slot `cta?: ReactNode`. Rende lo
stepper + la card (barra arancione se 'azione', grigia se 'attesa', rossa tenue se
chiusaNegativa) con titolo/descrizione; se `variant==='azione'` mostra lo slot
`cta` (con `animate-pulse-soft`). Riusa palette/`Card` esistenti.

**1c. Integrazione** in `page.tsx`: calcolare `guida = guidaStep({stato, ruolo, hasValutazione: !!pratica.valutazione})`; renderla in cima (dopo header, al posto dei banner `?param`). La **CTA primaria** (SubmitButton di processata/firma) viene passata nello slot `cta`; per `cta='valuta'` la guida è descrittiva e punta alla `ValutazioneForm` sottostante (che resta). Le azioni **secondarie** (annulla, segnala, scarica PDF) restano in una riga compatta sotto.

### Parte 2 — Toast di conferma

- `components/ui/toast.tsx`: implementazione leggera **senza nuove dipendenze** —
  `ToastProvider` (context) + hook `useToast()` + `Toaster` (lista in basso a
  destra, auto-dismiss ~4s, varianti success/error/info, coerente col design
  system). `Toaster`/provider montati nella shell (`app-shell.tsx`).
- **Wiring**:
  - Azioni client-transition (`ValutazioneForm`, `SegnalaProblemaButton`): chiamano
    `toast('Valutazione inviata', 'success')` / `'Segnalazione inviata'` nel ramo ok.
  - Azioni server-action con redirect `?param` (processata/firma/annulla): un
    piccolo client `PraticaToasts` legge `searchParams` al mount
    (`firmata`/`processata`/`annullata`/`error`), emette il toast corrispondente e
    pulisce l'URL (`router.replace`). Sostituisce i banner `Alert` da `?param`.
- Scope toast v1: **flusso pratica** (accetta/rifiuta inbox, processata, firma,
  annulla, valutazione, segnalazione). Altri `?saved` (profilo, ecc.) restano
  invariati per ora.

### Parte 3 — Hint "cosa fare ora" (leggeri)

- **Inbox** (`app/inbox/page.tsx`): banner conciso in cima quando ci sono pending,
  es. "Hai **N** pratiche in attesa di risposta" (N = count PENDING già calcolato).
- **Dashboard** agenzia (`agenzia-dashboard.tsx`): banner "Cosa fare ora" se ci
  sono azioni in sospeso (pratiche ACCETTATA/PROCESSATA da far avanzare, o
  pending da accettare), con link a /inbox o /pratiche. Broker
  (`broker-dashboard.tsx`): banner se ci sono pratiche FIRMATA da valutare.
- Implementazione leggera: piccoli banner (riusano `Alert`/`Card`), nessuna nuova
  logica complessa; i conteggi sono query semplici.

## Data flow / error handling
- Tutto presentazionale / sola lettura tranne i toast (client state). Nessuna
  modifica alle server action né allo schema.
- `guidaStep` è una funzione pura → testabile in isolamento.
- Toast: errori già gestiti dalle action; il toast 'error' mostra il messaggio.

## Testing
- **Unit** `guida-step.test.ts`: per ogni combinazione rilevante stato×ruolo
  verificare `variant`, `cta`, `titolo` chiave e gli step done/current.
- typecheck + build + suite esistente verde.
- Verifica manuale: percorrere il flusso (broker invia → agenzia accetta/processa/
  firma → broker valuta) e controllare guida + toast a ogni passo.

## Fuori scope
- Centro-notifiche a campanella (IN_APP feed) — idea futura.
- Conversione a toast dei feedback fuori dal flusso pratica (profilo, team, ecc.).

## Piano commit
1. Funzione pura `guidaStep` + test.
2. Componente `GuidaStep` + integrazione nel dettaglio pratica (CTA primaria nello slot, azioni secondarie nella riga).
3. Toaster (`ui/toast`) + provider nella shell + wiring azioni pratica (incl. `PraticaToasts` da searchParams).
4. Hint "cosa fare ora" su inbox + dashboard.
