# UI: Larghezza uniforme pagine + pattern lista-first con modali

**Data:** 2026-05-11
**Owner:** dev@carpediemsrl.net
**Status:** Approvato (in attesa di review scritta)

## Obiettivo

Uniformare l'esperienza di tutte le pagine autenticate del backoffice Passaggio Veloce sotto due regole generali:

1. **Larghezza uniforme** — ogni pagina raggiungibile da tab navigation (e relative sotto-pagine) usa lo stesso container `max-w-6xl`, come `/wallet` oggi. Niente container più stretti annidati.
2. **Pattern lista-first** — pagine che oggi mostrano un form di creazione sopra una lista (`/team`, `/admin/assistenti`) vengono ristrutturate: la lista è il contenuto primario, la creazione passa a una modale invocata da una CTA in alto a destra.

Beneficio atteso: coerenza visiva e percezione di pulizia. Niente più "blocchi uno sotto l'altro" sui resource-CRUD.

## Scope

### In scope

- **Pagine landing tab** di tutti i ruoli: `/dashboard`, `/pratiche` (broker + admin), `/inbox`, `/orari`, `/wallet`, `/affiliazione`, `/notifiche`, `/profilo`, `/team`, e tutti gli `/admin/*` (`/admin/dashboard`, `/admin/broker`, `/admin/agenzie`, `/admin/utenti`, `/admin/crm/*`, `/admin/escalation`, `/admin/segnalazioni`, `/admin/revisioni`, `/admin/affiliazioni*`, `/admin/assistenti*`, `/admin/audit-log`, `/admin/listini`, `/admin/demo-control`).
- **Sotto-pagine** raggiungibili dalle tab: `/profilo/azienda`, `/profilo/sicurezza`, `/profilo/personale`, `/profilo/listino`, `/team/[userId]/edit`, `/admin/assistenti/[id]/edit`, `/admin/companies/[id]`, `/admin/affiliazioni/sospette`, `/pratiche/[id]`, `/inbox/[id]`.
- **Conversione modale** del flusso di creazione su `/team` (CreateUser + InviteEmail) e `/admin/assistenti` (CreateAssistente).
- **Riarrangiamento a grid 2 colonne** dei form interni delle sotto-pagine `/profilo/sicurezza`, `/profilo/personale`, `/profilo/azienda`, `/team/[id]/edit`, `/admin/assistenti/[id]/edit` (dove sensato: campi anagrafici corti accoppiati).
- **Nuova primitiva UI** `<Modal>` riutilizzabile in `components/ui/modal.tsx`.

### Out of scope

- Conversione del `confirm()` nativo nei bottoni `RevokeButton` e `DisableTeamUserButton` a modale custom (segue in PR dedicata).
- Refactor delle pagine lista già conformi al pattern (`/pratiche`, `/notifiche`, `/inbox`): CTA porta a pagina dedicata (`/pratiche/nuova`), non a modale.
- Aggiunta di filtri/search a `/team` e `/admin/assistenti`: la toolbar è predisposta ma resta vuota a sinistra in questa iterazione (≤ 10 record tipici).
- Modifiche a `/profilo/listino` form interno (è un wizard tariffe complesso, troppa superficie per accoppiarlo a questo PR).
- Modifiche allo schema database, alle server action, alla logica di business.

## Architettura

### Parte A — Container width uniforme

Pattern target unico per ogni pagina autenticata, da applicare al `<div>` direttamente dentro `<AppShell>`:

```tsx
<div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
```

Variazioni accettate solo per:
- `py-*` esistente coerente (es. `py-10` invece di `py-8` su qualche pagina — uniformare a `py-8 sm:py-10`).
- Branch di errore/redirect interni (es. wallet `non-DEALER/AGENZIA` shows banner): mantengono il loro layout finché restano dentro `max-w-6xl`.

**Conteggio approssimativo file toccati**: 35-40 file `page.tsx` con uno o due grep+replace meccanici.

### Parte B — Pattern lista-first

Struttura nuova target per `/team` e `/admin/assistenti`:

```
<AppShell>
  <Container max-w-6xl>
    <header>
      <eyebrow>Azienda</eyebrow>
      <H1>Team</H1>
      <description>...</description>
    </header>

    <Toolbar>
      <FilterArea>{/* vuoto in questa iter */}</FilterArea>
      <ActionArea>
        <Button onClick={openModal}>+ Aggiungi utente</Button>
      </ActionArea>
    </Toolbar>

    <Card>
      <UsersList />
    </Card>

    {invitations.length > 0 && (
      <Card>
        <PendingInvitationsList />
      </Card>
    )}

    <AddUserModal />
  </Container>
</AppShell>
```

#### Modale `/team` — due tab

Tabs interni:
- **"Imposta password"** → ricolloca `CreateUserForm` esistente (server action `createUserDirectAction`).
- **"Invita via email"** → ricolloca `InviteForm` esistente (server action `createInvitationAction`).

Apertura: la modale rimane aperta durante submit; su success chiama `onSuccess` che chiude la modale e fa `revalidatePath` (già emesso dalle action). Su errore mostra l'errore inline come ora.

Dead-code rimosso: il blocco `<details>` "in alternativa: invia un invito via email" sparisce dalla pagina; la `InviteForm` viene importata solo dal componente modale.

#### Modale `/admin/assistenti` — single form

Stessa primitiva, una sola tab/contenuto (no switcher). Niente cambiamenti a `CreateAssistenteForm` né a `createAssistenteAction`.

### Parte C — Componente `<Modal>`

Nuovo file `apps/piattaforma/src/components/ui/modal.tsx`:

```ts
type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg';   // default 'md' (max-w-lg/xl/2xl)
  children: ReactNode;
};
```

Comportamento:
- Overlay scuro semitrasparente (`bg-pv-navy-900/40`) + backdrop blur leggero.
- Close su tasto **Esc**, click su overlay, e bottone **X** in alto a destra.
- **Focus trap** basico: al mount focus al primo elemento focusabile dentro `[role="dialog"]`; Tab/Shift+Tab restano dentro la modale; al unmount restore focus al trigger.
- Animazione fade-in + scale dello pannello (CSS keyframes, no librerie).
- Portal in `<body>` via `createPortal` (NextJS client component, `'use client'`).
- Body scroll-lock quando aperto (`overflow-hidden` su html).
- Markup ARIA: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` linked all'H2 del titolo.

Niente dipendenze esterne (headless-ui, radix, etc.) — stesso stack del resto.

Esportato da `components/ui/index.ts`.

### Parte D — Form 2-colonne sotto-pagine

Pagine target:
- `/profilo/sicurezza` (`client.tsx`) — sezione 2FA + sezione password change accostate orizzontalmente dove possibile.
- `/profilo/personale` (`form.tsx`) — anagrafica: nome│cognome, codiceFiscale│dataNascita, luogoNascita│(vuoto).
- `/profilo/azienda` — ragioneSociale full, P.IVA│codiceSdi, PEC│email, telefono│IBAN, indirizzo full, citta│cap, provincia│(vuoto).
- `/team/[userId]/edit` (`edit-form.tsx`) — email full, nome│cognome.
- `/admin/assistenti/[id]/edit` — stesso schema.

Pattern di griglia condiviso: `grid grid-cols-1 gap-4 sm:grid-cols-2`. Submit bar full-width sotto.

I bottoni di sezione (es. "Reset password" su `/team/[id]/edit`, "Setup 2FA" su `/profilo/sicurezza`) restano in `<Card>` separate sotto.

## Dati e API

Nessuna modifica al database. Nessuna nuova server action. Le action esistenti (`createUserDirectAction`, `createInvitationAction`, `createAssistenteAction`) vengono chiamate dai form ora ospitati in modale senza cambiamenti di firma.

## Test

Test manuali (per ruolo, in dev):

- **Dealer (`dealer1@`)** — verifica `max-w-6xl` su: dashboard, pratiche, wallet, affiliazione, notifiche, profilo (+ sub-pages), team (+ flusso modale "Aggiungi utente" two-tab).
- **Agenzia (`agenzia1@`)** — verifica dashboard, inbox, pratiche, orari, wallet, affiliazione, notifiche, profilo.
- **Admin platform (`admin@`)** — verifica dashboard, admin/pratiche, admin/broker, admin/agenzie, admin/utenti, admin/crm (tutte sotto-tab), admin/escalation, admin/segnalazioni, admin/revisioni, admin/affiliazioni (+ sospette), admin/assistenti (+ flusso modale), admin/audit-log, admin/listini, admin/demo-control.

Test automatici Playwright esistenti: verificare regressioni su `/team` test (se presente) per il flusso di creazione utente — il submit attraverso modale deve funzionare uguale.

Acceptance:
- Tutte le pagine autenticate hanno container `max-w-6xl` o equivalente coerente.
- Su `/team` e `/admin/assistenti` non c'è più form di creazione inline; la CTA in alto a destra apre una modale che permette le stesse azioni di prima.
- Modale chiude su Esc, click overlay, X.
- Esistenti `confirm()` su Disable/Revoke continuano a funzionare invariati (out-of-scope la conversione).

## Rollout

Singolo PR. Niente feature flag — è puro lavoro visivo non breaking sull'API.

## Open questions / Decisioni prese

- ✅ Larghezza target: `max-w-6xl` (≈1152px), stessa di `/wallet`.
- ✅ Scope: include sotto-pagine.
- ✅ Modale `/team`: due tab in una sola modale.
- ✅ Form sub-page: grid 2 colonne dove sensato.
- ✅ Filtri toolbar: stub vuoto, no implementazione filtri in questa iter.
- ✅ Modale primitiva: vanilla Tailwind, no librerie.

## File toccati (stima)

- 1 nuovo: `components/ui/modal.tsx`
- 1 nuovo: `app/team/add-user-modal.tsx` (wrapper modale due tab)
- 1 nuovo: `app/admin/assistenti/add-assistente-modal.tsx`
- 1 modifica: `components/ui/index.ts` (export Modal)
- 2 modifiche: `app/team/page.tsx`, `app/admin/assistenti/page.tsx` (struttura lista-first)
- ~35 modifiche meccaniche `className` su tutte le page.tsx restanti
- ~5 modifiche di griglia interne ai form sub-page

Totale stimato: ~45 file.
