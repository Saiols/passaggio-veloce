# Ruolo e sede dell'utente loggato nella sidebar — Design

Data: 2026-07-12
Stato: approvato (Francesco), pronto per il piano di implementazione

## Contesto

Da loggati non si capisce **con che ruolo** si sta usando la piattaforma né **su quale sede**.
La card utente in sidebar mostra oggi solo iniziali, nome e ragione sociale.

Richiesta: mostrare ruolo e sede di appartenenza; per il titolare di agenzia/broker
mostrare la sede **solo quando è in modalità sede selezionata** (non quando opera in
vista aggregata su tutte le sedi).

## Cosa esiste già (verificato)

- **Card utente**: `components/sidebar-shell.tsx:211-229`. Un solo componente, riusato da
  tre wrapper: `broker-shell.tsx`, `agenzia-shell.tsx`, `admin-shell.tsx`.
- ⚠️ **Trappola**: la prop si chiama `roleLabel` (`sidebar-shell.tsx:56,67`) ma per
  broker e agenzia **contiene la ragione sociale**, non il ruolo
  (`broker-shell.tsx:70`: `roleLabel={companyName || 'Broker'}`). È usata sia nella card
  (riga 219) sia nel footer (riga 267). Solo in `admin-shell.tsx:128-132` contiene davvero
  un ruolo.
- **Nessuna mappa centralizzata delle etichette di ruolo**: sono sparse e discordanti in 6
  punti (`admin-shell` → "Admin piattaforma"; `team/page.tsx:117` → "Admin"/"Utente";
  `invite-form.tsx:97` → "Admin di sede"/"Operatore").
- **Scope sede**: `lib/auth/session-context.ts` espone `currentSede: { kind: 'ALL' } |
  { kind: 'ONE', sede } | null`, `isOwner`, `accessibleSedi`, `membershipRuoli`.
  `lib/sedi/scope.ts:142` ha già `resolveSedeRole()` → `'OWNER' | 'ADMIN_SEDE' | 'OPERATORE' | null`.
- **Solo l'owner può stare in `ALL`** (`scope.ts:55`: `if (isOwner) return { kind: 'ALL' }`);
  un non-owner è **sempre** su una sede singola. Quindi la clausola "solo se in modalità sede
  selezionata" riguarda per costruzione il solo titolare.
- `nomeSedeDistintivo(nome, ragioneSociale)` (`lib/pratiche/colonna-sede.ts:38`) restituisce
  `null` quando il nome della sede coincide con la ragione sociale — cosa che accade quasi
  sempre, perché la sede creata alla registrazione eredita il nome dell'azienda.

## Decisioni

### D1 — Il titolare mono-sede vede comunque la sua sede

Applicare la regola alla lettera («in `ALL` non mostrare la sede») lascerebbe **senza sede la
maggioranza dei titolari**: sul DB di produzione **4 aziende su 5 hanno una sola sede**, e il
titolare resta in `ALL` finché non ne seleziona una — cosa che con una sede sola non può nemmeno
fare (il selettore compare solo con `accessibleSedi.length > 1`,
`components/sede/sede-switcher.tsx:31`).

L'intento della clausola è «non mostrarmi UNA sede mentre ne sto guardando N». Con una sede sola
il rischio non esiste: aggregato e sede singola coincidono.

**Regola adottata:**

| Situazione | Riga mostrata |
|---|---|
| Titolare, 1 sola sede accessibile | `Titolare · <sede>` |
| Titolare, N sedi, vista aggregata (`kind: 'ALL'`) | `Titolare · Tutte le sedi` |
| Titolare, N sedi, sede selezionata (`kind: 'ONE'`) | `Titolare · <sede>` |
| Admin di sede / Operatore (sempre `ONE`) | `Admin di sede · <sede>` |
| Admin piattaforma / Assistente (nessuna sede) | `Admin piattaforma` |
| Nessuna sede accessibile (`currentSede === null`) | solo il ruolo, nessuna sede |

### D2 — Il ruolo mostrato segue la sede corrente

Per un non-owner `User.role` è sempre `UTENTE_AZIENDA`: il ruolo utile sta nella **membership
della sede** (`UserSede.ruolo`). La stessa persona può essere Admin di sede a Corsico e
Operatore a Milano: l'etichetta deve quindi essere calcolata **sulla sede corrente**, non
sull'utente in astratto. Si usa `resolveSedeRole()`, che già fa esattamente questo.

### D3 — Vocabolario dei ruoli

| Origine | Etichetta |
|---|---|
| `isOwner` (`User.role = ADMIN_AZIENDA`) | **Titolare** |
| `UserSede.ruolo = ADMIN_SEDE` | **Admin di sede** |
| `UserSede.ruolo = OPERATORE` | **Operatore** |
| `User.role = ADMIN_PIATTAFORMA` | **Admin piattaforma** |
| `User.role = ASSISTENTE` | **Assistente** |
| Ruoli CRM interni (`AD`, `CTO`, `CFO`, `SALES_MANAGER`, `SALES`) | **Staff** |

Riusa le parole già presenti nel Team ("Admin di sede", "Operatore"). "Titolare" invece di
"Admin" perché quest'ultimo oggi si confonde con l'admin di piattaforma.

### D4 — Come si scrive il nome della sede

`nomeSedeDistintivo(sede.nome, ragioneSociale) ?? sede.citta` — la stessa funzione (già testata)
usata dalla colonna Sede della lista pratiche. Effetto: la ragione sociale non compare **due
volte** nella stessa card (sede "Dimensione Auto Milano Srls" sotto azienda "Dimensione Auto
Milano Srls" → mostra `Buccinasco`); quando la sede ha un nome proprio ("Dimensione Auto
Corsico") quel nome ricompare da solo.

⚠️ **`SedeRef` oggi è `{ id, nome, type }` e NON contiene `citta`**
(`lib/sedi/scope.ts:11-15`, select in `session-context.ts:78`). Va aggiunto il campo `citta` al
tipo e alla select. È additivo: nessuna migration, nessun consumatore rotto.

## Architettura

**Modulo puro nuovo** — `lib/auth/permessi/ruoli.ts`:

```ts
export type RuoloVisualizzato =
  | 'Titolare' | 'Admin di sede' | 'Operatore'
  | 'Admin piattaforma' | 'Assistente' | 'Staff';

/** Etichetta del ruolo con cui l'utente sta operando ORA (dipende dalla sede corrente). */
export function etichettaRuolo(args: {
  role: string;                                  // User.role
  sedeRole: 'OWNER' | 'ADMIN_SEDE' | 'OPERATORE' | null;  // da resolveSedeRole()
}): RuoloVisualizzato;
```

**Modulo puro nuovo** — `lib/sedi/etichetta-sede.ts`:

```ts
/** Testo della sede per la card utente. `null` = non mostrare nulla. */
export function etichettaSede(args: {
  currentSede: CurrentSede | null;
  accessibleSediCount: number;
  ragioneSociale: string | null | undefined;
}): string | null;
```
Regole: `ONE` → `nomeSedeDistintivo(...) ?? citta`; `ALL` con 1 sede accessibile → la sede stessa;
`ALL` con più sedi → `'Tutte le sedi'`; `null` → `null`.

**Punto di calcolo:** `components/app-shell.tsx`, che chiama già `getSessionContext()`
(riga 138). Calcola `ruoloLabel` e `sedeLabel` una volta e li passa a Broker/Agenzia/AdminShell →
`SidebarShell`.

**Rinomina obbligatoria:** in `SidebarShell` (e nelle tre shell chiamanti) `roleLabel` →
`companyLabel`, e si aggiungono `ruoloLabel: string` e `sedeLabel: string | null`. Senza questa
rinomina resterebbe una prop chiamata "role" che contiene l'azienda, accanto a una che contiene
davvero il ruolo: una trappola per il prossimo che legge.

**Card utente risultante** (`sidebar-shell.tsx:217-220`):

```
Andrea Saino                 ← userName (invariato)
Dimensione Auto Milano Srls  ← companyLabel (era roleLabel)
Titolare · Buccinasco        ← NUOVO: ruoloLabel + sedeLabel
```
La terza riga è `truncate`, colore tenue (`text-[#8aa6cd]`, come la riga azienda) e più piccola.
Se `sedeLabel` è `null` mostra il solo ruolo. Nessun colore hardcoded fuori dal design system già
in uso nella sidebar.

**Footer:** invariato (continua a mostrare l'azienda).

## Test

- `lib/auth/permessi/ruoli.test.ts`: owner → 'Titolare' anche con `sedeRole` null; membership
  ADMIN_SEDE/OPERATORE → etichette corrispondenti; ADMIN_PIATTAFORMA/ASSISTENTE; ruoli CRM → 'Staff';
  **invariante**: ogni valore dell'enum `UserRole` produce un'etichetta non vuota (nessun ruolo
  nuovo può finire in una card vuota).
- `lib/sedi/etichetta-sede.test.ts`: i 5 casi della tabella D1, più il caso in cui il nome sede
  coincide con la ragione sociale (→ città) e quello in cui è distinto (→ nome).
- Verifica sull'app reale (DB locale): titolare mono-sede, titolare multi-sede in ALL e in ONE,
  admin di sede, operatore, admin piattaforma. Il ruolo deve **cambiare** cambiando sede per un
  utente con membership diverse.

## Rischi noti

- **Nessuna migration.**
- `SedeRef` guadagna `citta`: additivo, ma tocca un tipo centrale (`scope.ts`) usato da
  `scope-filters.ts` e dal selettore sede. Nessun consumatore va rotto.
- La top-bar di fallback (`app-shell.tsx:181+`, usata solo dai ruoli CRM interni senza
  `companyType`) e il selettore di sede restano **fuori scope**.
