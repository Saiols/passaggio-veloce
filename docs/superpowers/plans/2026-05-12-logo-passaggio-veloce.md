# Logo Passaggio Veloce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generare il brand kit SVG completo per Passaggio Veloce (icona + lockup in 4 varianti colore) e sostituire i reference al logo esistente nei punti d'uso della piattaforma.

**Architecture:** 8 file SVG statici in `apps/piattaforma/public/brand/` — niente build step, niente font tooling esterno (il testo è renderizzato come `<text>` SVG con stack `font-family` Geist/sans). Lo swap è una serie di Edit puntuali su 3 file TSX + un cleanup di asset legacy.

**Tech Stack:** SVG hand-written, Next.js `<Image>` component, Tailwind classes esistenti.

**Riferimento spec:** `docs/superpowers/specs/2026-05-12-logo-passaggio-veloce-design.md`

---

## File Structure

Nuovi file da creare:

```
apps/piattaforma/public/brand/
├── logo-primary.svg          # NEW · lockup color, sfondo chiaro
├── logo-dark.svg             # NEW · lockup, sfondo navy
├── logo-mono-white.svg       # NEW · lockup mono bianco
├── logo-mono-navy.svg        # NEW · lockup mono navy (stampa B/N)
├── icon.svg                  # NEW · icona color (64+ px)
├── icon-mono-white.svg       # NEW · icona mono bianca
├── icon-mono-navy.svg        # NEW · icona mono navy
├── favicon.svg               # NEW · icona semplificata 16px
└── logo.svg                  # EXISTING · resta come fallback fino a Task 13
```

File da modificare:

```
apps/piattaforma/src/components/app-shell.tsx           # topbar autenticata → logo-dark
apps/piattaforma/src/components/site-header.tsx         # marketing/auth → logo-primary
apps/piattaforma/src/app/layout.tsx                     # <link rel="icon"> + Apple touch icon
```

File legacy da eliminare al Task 13 (dopo verifica visiva):

```
apps/piattaforma/public/brand/logo.svg                  # vecchio logo, sostituito
apps/piattaforma/public/brand/logo-full.png             # legacy
apps/piattaforma/public/brand/logo-white.png            # legacy
apps/piattaforma/public/brand/icon.png                  # legacy
```

---

## Coordinate condivise dell'icona

L'arte dell'icona usa lo stesso viewBox `0 0 64 64` in tutti i file. Path-list di riferimento (poi ogni Task adatta `fill`):

- **Documento (rettangolo con angolo piegato):** `M14 8 H38 L52 22 V58 H14 Z`
- **Angolo piegato (linea):** `M38 8 V22 H52`
- **Riga testo 1:** `<rect x="21" y="27" width="22" height="2" rx="1"/>`
- **Riga testo 2:** `<rect x="21" y="33" width="26" height="2" rx="1"/>`
- **Riga testo 3:** `<rect x="21" y="39" width="16" height="2" rx="1"/>`
- **Fulmine:** `M37 13 L26 33 L34 33 L29 51 L46 29 L38 29 Z`

## Wordmark — pattern condiviso

Tutti i file lockup usano la stessa struttura per il testo:

```xml
<g transform="translate(96 0) skewX(-6)" font-family="Geist, Inter, 'Helvetica Neue', Arial, sans-serif"
   font-style="italic" font-weight="900" font-size="42" letter-spacing="-1">
  <text y="48" fill="{COLOR_PASSAGGIO}">Passaggio</text>
  <text y="48" x="{X_VELOCE}" fill="{COLOR_VELOCE}">Veloce</text>
</g>
```

Dove `X_VELOCE` è calcolato dinamicamente con un secondo `<text>` (più semplice che spezzare in due `<tspan>` con dx).

**Approccio definitivo per allineamento del testo "Veloce":** uso un solo `<text>` con due `<tspan>` di colore diverso:

```xml
<text y="48" font-family="..." font-weight="900" font-size="42" font-style="italic" letter-spacing="-1">
  <tspan fill="#0a2540">Passaggio</tspan><tspan fill="#ff7a00">Veloce</tspan>
</text>
```

ViewBox del lockup orizzontale: `0 0 360 64` (icona 64px + gap 4px + wordmark ~290px).

---

## Task 1: Setup — verifica ambiente

**Files:**
- Inspect: `apps/piattaforma/public/brand/`

- [ ] **Step 1.1:** Confermare cartella esistente.

```bash
ls apps/piattaforma/public/brand/
```

Expected output: `icon.png  logo-full.png  logo-white.png  logo.svg`

- [ ] **Step 1.2:** Aprire Next.js dev server in background per poter ispezionare gli SVG via browser dopo ogni task.

```bash
pnpm --filter piattaforma dev
```

Lascia il server attivo per tutta la durata del plan. URL: `http://localhost:3000/brand/<filename>.svg` per ispezionare singoli SVG.

---

## Task 2: Genera `icon.svg` (icona color)

**Files:**
- Create: `apps/piattaforma/public/brand/icon.svg`

- [ ] **Step 2.1:** Scrivere il file `icon.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title">
  <title id="title">Passaggio Veloce</title>
  <path d="M14 8 H38 L52 22 V58 H14 Z" fill="#0a2540"/>
  <path d="M38 8 V22 H52" fill="none" stroke="#003f8a" stroke-width="1"/>
  <rect x="21" y="27" width="22" height="2" rx="1" fill="#e8eef7" opacity=".55"/>
  <rect x="21" y="33" width="26" height="2" rx="1" fill="#e8eef7" opacity=".55"/>
  <rect x="21" y="39" width="16" height="2" rx="1" fill="#e8eef7" opacity=".55"/>
  <path d="M37 13 L26 33 L34 33 L29 51 L46 29 L38 29 Z" fill="#ff7a00" stroke="#0a2540" stroke-width="1.4" stroke-linejoin="round"/>
</svg>
```

- [ ] **Step 2.2:** Verifica visiva.

Apri `http://localhost:3000/brand/icon.svg` nel browser. Deve mostrare il documento navy con il fulmine arancio bordato di navy. Nessun errore di parsing nella console del browser.

---

## Task 3: Genera `icon-mono-white.svg`

**Files:**
- Create: `apps/piattaforma/public/brand/icon-mono-white.svg`

- [ ] **Step 3.1:** Scrivere il file:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title">
  <title id="title">Passaggio Veloce</title>
  <path d="M14 8 H38 L52 22 V58 H14 Z" fill="#ffffff"/>
  <path d="M38 8 V22 H52" fill="none" stroke="#ffffff" stroke-width="1" opacity=".6"/>
  <rect x="21" y="27" width="22" height="2" rx="1" fill="#ffffff" opacity=".4"/>
  <rect x="21" y="33" width="26" height="2" rx="1" fill="#ffffff" opacity=".4"/>
  <rect x="21" y="39" width="16" height="2" rx="1" fill="#ffffff" opacity=".4"/>
  <path d="M37 13 L26 33 L34 33 L29 51 L46 29 L38 29 Z" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round"/>
</svg>
```

Nota: la versione mono bianca disegna il fulmine come outline bianco (non riempito) per restare leggibile dentro al documento bianco.

- [ ] **Step 3.2:** Verifica visiva su sfondo scuro.

Crea un file di test temporaneo, oppure apri `http://localhost:3000/brand/icon-mono-white.svg` e visualizzalo su sfondo scuro tramite la dev tools (override del background).

---

## Task 4: Genera `icon-mono-navy.svg`

**Files:**
- Create: `apps/piattaforma/public/brand/icon-mono-navy.svg`

- [ ] **Step 4.1:** Scrivere il file:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title">
  <title id="title">Passaggio Veloce</title>
  <path d="M14 8 H38 L52 22 V58 H14 Z" fill="#0a2540"/>
  <path d="M38 8 V22 H52" fill="none" stroke="#0a2540" stroke-width="1"/>
  <rect x="21" y="27" width="22" height="2" rx="1" fill="#ffffff" opacity=".55"/>
  <rect x="21" y="33" width="26" height="2" rx="1" fill="#ffffff" opacity=".55"/>
  <rect x="21" y="39" width="16" height="2" rx="1" fill="#ffffff" opacity=".55"/>
  <path d="M37 13 L26 33 L34 33 L29 51 L46 29 L38 29 Z" fill="#ffffff" stroke="#0a2540" stroke-width="1.4" stroke-linejoin="round"/>
</svg>
```

- [ ] **Step 4.2:** Verifica visiva su sfondo bianco.

Apri `http://localhost:3000/brand/icon-mono-navy.svg`. Deve apparire come il logo color ma con fulmine bianco al posto di arancione.

---

## Task 5: Genera `favicon.svg` (semplificato)

**Files:**
- Create: `apps/piattaforma/public/brand/favicon.svg`

- [ ] **Step 5.1:** Scrivere il favicon — versione semplificata senza le righe testo del documento (a 16×16 sarebbero noise illeggibile):

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title">
  <title id="title">Passaggio Veloce</title>
  <path d="M14 8 H38 L52 22 V58 H14 Z" fill="#0a2540"/>
  <path d="M37 13 L26 33 L34 33 L29 51 L46 29 L38 29 Z" fill="#ff7a00" stroke="#0a2540" stroke-width="3" stroke-linejoin="round"/>
</svg>
```

Stroke del fulmine aumentato da 1.4 a 3 per leggibilità a piccole dimensioni.

- [ ] **Step 5.2:** Verifica visiva a 16px.

Apri `http://localhost:3000/brand/favicon.svg`, riduci lo zoom del browser al 25% per simulare 16×16. Il fulmine arancio deve restare distinguibile dal documento navy.

---

## Task 6: Commit dei 4 file icon

- [ ] **Step 6.1:** Commit.

```bash
git add apps/piattaforma/public/brand/icon.svg apps/piattaforma/public/brand/icon-mono-white.svg apps/piattaforma/public/brand/icon-mono-navy.svg apps/piattaforma/public/brand/favicon.svg
git commit -m "feat(brand): icone SVG (color, mono bianca, mono navy, favicon)

Icona documento + fulmine in 4 varianti, viewBox 64x64.
Favicon usa fulmine con stroke maggiorato per leggibilita a 16px.

Riferimento spec: docs/superpowers/specs/2026-05-12-logo-passaggio-veloce-design.md"
```

---

## Task 7: Genera `logo-primary.svg` (lockup color)

**Files:**
- Create: `apps/piattaforma/public/brand/logo-primary.svg`

- [ ] **Step 7.1:** Scrivere il lockup orizzontale color.

Dimensionamento: icona 64×64 a x=0, gap 4px, testo da x=68. ViewBox `0 0 360 64`.

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 64" role="img" aria-labelledby="title">
  <title id="title">Passaggio Veloce</title>
  <!-- Icona -->
  <g>
    <path d="M14 8 H38 L52 22 V58 H14 Z" fill="#0a2540"/>
    <path d="M38 8 V22 H52" fill="none" stroke="#003f8a" stroke-width="1"/>
    <rect x="21" y="27" width="22" height="2" rx="1" fill="#e8eef7" opacity=".55"/>
    <rect x="21" y="33" width="26" height="2" rx="1" fill="#e8eef7" opacity=".55"/>
    <rect x="21" y="39" width="16" height="2" rx="1" fill="#e8eef7" opacity=".55"/>
    <path d="M37 13 L26 33 L34 33 L29 51 L46 29 L38 29 Z" fill="#ff7a00" stroke="#0a2540" stroke-width="1.4" stroke-linejoin="round"/>
  </g>
  <!-- Wordmark italic skew -->
  <g transform="translate(68 0) skewX(-6)">
    <text y="44" font-family="Geist, Inter, 'Helvetica Neue', Arial, sans-serif"
          font-style="italic" font-weight="900" font-size="30" letter-spacing="-0.5">
      <tspan fill="#0a2540">Passaggio</tspan><tspan fill="#ff7a00">Veloce</tspan>
    </text>
  </g>
</svg>
```

- [ ] **Step 7.2:** Verifica visiva e larghezza reale.

Apri `http://localhost:3000/brand/logo-primary.svg`. Verifica:
- testo allineato verticalmente al centro dell'icona
- gap stretto (4px) tra fulmine e "P" di Passaggio
- "Veloce" in arancio

Se il testo eccede x=380 nel viewBox (taglio a destra visibile), aumentare il `viewBox` width a `420` o `480` (cambia solo l'ultimo attributo numerico di `viewBox`). Applicare la stessa correzione a tutti gli altri 3 file lockup ai Task 8/9/10. Se invece c'è troppo spazio bianco a destra, ridurre a `340`.

---

## Task 8: Genera `logo-dark.svg` (lockup su sfondo navy)

**Files:**
- Create: `apps/piattaforma/public/brand/logo-dark.svg`

- [ ] **Step 8.1:** Scrivere il file (stessa struttura di logo-primary ma con icona "dark" e testo bianco):

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 64" role="img" aria-labelledby="title">
  <title id="title">Passaggio Veloce</title>
  <g>
    <path d="M14 8 H38 L52 22 V58 H14 Z" fill="#ffffff"/>
    <path d="M38 8 V22 H52" fill="none" stroke="#cbd5e1" stroke-width="1"/>
    <rect x="21" y="27" width="22" height="2" rx="1" fill="#0a2540" opacity=".25"/>
    <rect x="21" y="33" width="26" height="2" rx="1" fill="#0a2540" opacity=".25"/>
    <rect x="21" y="39" width="16" height="2" rx="1" fill="#0a2540" opacity=".25"/>
    <path d="M37 13 L26 33 L34 33 L29 51 L46 29 L38 29 Z" fill="#ff7a00" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/>
  </g>
  <g transform="translate(68 0) skewX(-6)">
    <text y="44" font-family="Geist, Inter, 'Helvetica Neue', Arial, sans-serif"
          font-style="italic" font-weight="900" font-size="30" letter-spacing="-0.5">
      <tspan fill="#ffffff">Passaggio</tspan><tspan fill="#ff7a00">Veloce</tspan>
    </text>
  </g>
</svg>
```

- [ ] **Step 8.2:** Verifica visiva su sfondo navy.

Apri `http://localhost:3000/brand/logo-dark.svg`. Il file sarà su sfondo bianco di default del browser — usa le devtools per cambiare `body { background: #0a2540 }` e verifica che il documento bianco e il testo bianco siano leggibili.

---

## Task 9: Genera `logo-mono-white.svg`

**Files:**
- Create: `apps/piattaforma/public/brand/logo-mono-white.svg`

- [ ] **Step 9.1:** Scrivere il file (tutto bianco/outline, per sfondo arancio o foto):

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 64" role="img" aria-labelledby="title">
  <title id="title">Passaggio Veloce</title>
  <g>
    <path d="M14 8 H38 L52 22 V58 H14 Z" fill="#ffffff"/>
    <path d="M38 8 V22 H52" fill="none" stroke="#ffffff" stroke-width="1" opacity=".6"/>
    <rect x="21" y="27" width="22" height="2" rx="1" fill="#ffffff" opacity=".4"/>
    <rect x="21" y="33" width="26" height="2" rx="1" fill="#ffffff" opacity=".4"/>
    <rect x="21" y="39" width="16" height="2" rx="1" fill="#ffffff" opacity=".4"/>
    <path d="M37 13 L26 33 L34 33 L29 51 L46 29 L38 29 Z" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round"/>
  </g>
  <g transform="translate(68 0) skewX(-6)">
    <text y="44" font-family="Geist, Inter, 'Helvetica Neue', Arial, sans-serif"
          font-style="italic" font-weight="900" font-size="30" letter-spacing="-0.5" fill="#ffffff">
      <tspan>Passaggio</tspan><tspan>Veloce</tspan>
    </text>
  </g>
</svg>
```

- [ ] **Step 9.2:** Verifica visiva su sfondo arancio.

Apri il file, override `body { background: #ff7a00 }` nelle devtools. Tutto bianco, leggibile.

---

## Task 10: Genera `logo-mono-navy.svg`

**Files:**
- Create: `apps/piattaforma/public/brand/logo-mono-navy.svg`

- [ ] **Step 10.1:** Scrivere il file (tutto navy, per stampa B/N e PDF):

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 64" role="img" aria-labelledby="title">
  <title id="title">Passaggio Veloce</title>
  <g>
    <path d="M14 8 H38 L52 22 V58 H14 Z" fill="#0a2540"/>
    <path d="M38 8 V22 H52" fill="none" stroke="#0a2540" stroke-width="1"/>
    <rect x="21" y="27" width="22" height="2" rx="1" fill="#ffffff" opacity=".55"/>
    <rect x="21" y="33" width="26" height="2" rx="1" fill="#ffffff" opacity=".55"/>
    <rect x="21" y="39" width="16" height="2" rx="1" fill="#ffffff" opacity=".55"/>
    <path d="M37 13 L26 33 L34 33 L29 51 L46 29 L38 29 Z" fill="#ffffff" stroke="#0a2540" stroke-width="1.4" stroke-linejoin="round"/>
  </g>
  <g transform="translate(68 0) skewX(-6)">
    <text y="44" font-family="Geist, Inter, 'Helvetica Neue', Arial, sans-serif"
          font-style="italic" font-weight="900" font-size="30" letter-spacing="-0.5" fill="#0a2540">
      <tspan>Passaggio</tspan><tspan>Veloce</tspan>
    </text>
  </g>
</svg>
```

- [ ] **Step 10.2:** Verifica visiva su sfondo bianco.

Apri `http://localhost:3000/brand/logo-mono-navy.svg`. Tutto navy, leggibile.

---

## Task 11: Commit dei 4 lockup orizzontali

- [ ] **Step 11.1:** Commit.

```bash
git add apps/piattaforma/public/brand/logo-primary.svg apps/piattaforma/public/brand/logo-dark.svg apps/piattaforma/public/brand/logo-mono-white.svg apps/piattaforma/public/brand/logo-mono-navy.svg
git commit -m "feat(brand): lockup orizzontali SVG (primary, dark, mono bianco, mono navy)

Lockup icona + wordmark PassaggioVeloce in italic skew -6deg con stack
font Geist/Inter. ViewBox 360x64, gap 4px tra icona e testo.

Riferimento spec: docs/superpowers/specs/2026-05-12-logo-passaggio-veloce-design.md"
```

---

## Task 12: Swap reference in `app-shell.tsx` (topbar app)

**Files:**
- Modify: `apps/piattaforma/src/components/app-shell.tsx:97-102`

Contesto attuale: la topbar mostra un riquadro bianco con dentro `logo.svg` (18×18) + testo "Passaggio Veloce" affiancato. Con il nuovo logo dark che già include il wordmark, il riquadro bianco e il testo span diventano ridondanti.

**Decisione:** sostituire l'intero blocco logo+testo con un singolo `<Image>` che usa `logo-dark.svg` (lockup completo).

- [ ] **Step 12.1:** Modifica il blocco.

Old (lines 97-102 di app-shell.tsx):

```tsx
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white">
              <Image src="/brand/logo.svg" alt="" width={18} height={18} className="h-[18px] w-[18px]" />
            </span>
            <span className="text-[14px] font-extrabold tracking-tight">Passaggio Veloce</span>
          </Link>
```

New:

```tsx
          <Link href="/dashboard" className="flex items-center">
            <Image
              src="/brand/logo-dark.svg"
              alt="Passaggio Veloce"
              width={190}
              height={32}
              className="h-8 w-auto"
              priority
            />
          </Link>
```

- [ ] **Step 12.2:** Verifica visiva.

Vai su `http://localhost:3000/dashboard` (richiede login — usare credenziali dev). Verifica:
- topbar navy mostra il nuovo lockup bianco+arancio
- altezza 32px coerente con prima
- nessun overflow orizzontale a 1280px e 360px

---

## Task 13: Swap reference in `site-header.tsx` (marketing/auth)

**Files:**
- Modify: `apps/piattaforma/src/components/site-header.tsx:13-24`

Contesto attuale: marketing/auth header usa lo stesso pattern (icona 32×32 + testo affiancato). Sostituire con `logo-primary.svg`.

- [ ] **Step 13.1:** Modifica il blocco.

Old (lines 13-24):

```tsx
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/brand/logo.svg"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8"
          />
          <span className="text-[15px] font-extrabold tracking-tight text-pv-navy-800">
            Passaggio Veloce
          </span>
        </Link>
```

New:

```tsx
        <Link href="/" className="flex items-center">
          <Image
            src="/brand/logo-primary.svg"
            alt="Passaggio Veloce"
            width={214}
            height={36}
            className="h-9 w-auto"
            priority
          />
        </Link>
```

- [ ] **Step 13.2:** Verifica visiva.

Vai su `http://localhost:3000/` (homepage), `/login`, `/register/dealer`, `/register/agenzia`. Verifica:
- header bianco mostra il nuovo lockup navy+arancio
- nessun overflow su mobile (header `max-w-6xl px-5 sm:px-6`)

---

## Task 14: Aggiungi favicon in `layout.tsx`

**Files:**
- Modify: `apps/piattaforma/src/app/layout.tsx:16-19`

- [ ] **Step 14.1:** Aggiungere `icons` al `metadata`.

Old:

```tsx
export const metadata: Metadata = {
  title: "Passaggio Veloce — Broker digitale automotive",
  description: "Connettiamo dealer e agenzie pratiche auto in una piattaforma unica.",
};
```

New:

```tsx
export const metadata: Metadata = {
  title: "Passaggio Veloce — Broker digitale automotive",
  description: "Connettiamo dealer e agenzie pratiche auto in una piattaforma unica.",
  icons: {
    icon: [
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/brand/icon.svg", type: "image/svg+xml" },
    ],
  },
};
```

- [ ] **Step 14.2:** Verifica nel browser.

Hard refresh (`Ctrl+Shift+R`) di `http://localhost:3000/`. Il tab del browser deve mostrare il favicon nuovo (documento navy + fulmine arancio).

---

## Task 15: Commit swap reference

- [ ] **Step 15.1:** Commit.

```bash
git add apps/piattaforma/src/components/app-shell.tsx apps/piattaforma/src/components/site-header.tsx apps/piattaforma/src/app/layout.tsx
git commit -m "feat(brand): sostituisci logo nelle topbar app e marketing + favicon

- AppShell (autenticato): logo-dark sostituisce icon+span affiancati
- SiteHeader (marketing/auth): logo-primary sostituisce icon+span affiancati
- layout.tsx: favicon.svg + apple-touch-icon via metadata.icons

I lockup SVG includono gia il wordmark, quindi il testo span e stato rimosso."
```

---

## Task 16: Cleanup asset legacy

**Files:**
- Delete: `apps/piattaforma/public/brand/logo.svg`
- Delete: `apps/piattaforma/public/brand/logo-full.png`
- Delete: `apps/piattaforma/public/brand/logo-white.png`
- Delete: `apps/piattaforma/public/brand/icon.png`

- [ ] **Step 16.1:** Verifica che nessun reference residuo punti agli asset legacy.

```bash
grep -rn "logo-full\|logo-white\|/brand/icon.png\|/brand/logo.svg" apps/piattaforma/src
```

Expected output: nessun match. Se appare qualcosa, fix il reference prima di eliminare.

- [ ] **Step 16.2:** Elimina i file legacy.

```bash
git rm apps/piattaforma/public/brand/logo.svg apps/piattaforma/public/brand/logo-full.png apps/piattaforma/public/brand/logo-white.png apps/piattaforma/public/brand/icon.png
```

- [ ] **Step 16.3:** Commit cleanup.

```bash
git commit -m "chore(brand): rimuovi asset logo legacy (PNG e vecchio SVG)

Il vecchio logo.svg + le 3 PNG legacy sono sostituiti dal nuovo brand kit
SVG (logo-primary, logo-dark, logo-mono-*, icon, favicon).

Verificato: nessun reference residuo nel codice."
```

---

## Task 17: Verifica finale end-to-end

- [ ] **Step 17.1:** Build e type-check.

```bash
pnpm --filter piattaforma typecheck
pnpm --filter piattaforma build
```

Expected: nessun errore.

- [ ] **Step 17.2:** Smoke visivo su tutti i punti d'uso.

Apri in ordine e verifica logo + favicon:
- `http://localhost:3000/` (homepage marketing → logo-primary)
- `http://localhost:3000/login` (auth → logo-primary)
- `http://localhost:3000/register/dealer` (auth → logo-primary)
- `http://localhost:3000/dashboard` (dopo login → logo-dark sulla topbar)
- `http://localhost:3000/pratiche` (autenticato → logo-dark)
- Tab del browser: favicon nuovo

- [ ] **Step 17.3:** Commit finale (solo se ci sono modifiche residue, altrimenti skip).

```bash
git status   # se pulito, plan completo
```

---

## Non in scope di questo plan

- Generazione PNG/ICO da SVG (`sharp` o tool simili)
- SVG outlined (text → path) per uso stampa
- Refactor di tutti i punti dove appare la stringa "Passaggio Veloce" senza logo
- Aggiornamento template email (Resend) e PDF fatture — saranno target di un plan dedicato perché richiedono testing diverso (renderer email + Puppeteer/PDF)
