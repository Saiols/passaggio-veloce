# Restyle automotive — Design spec

**Data:** 2026-04-16
**Stato:** in review
**Autore:** dev@carpediemsrl.net
**Scope:** design system completo (auth + homepage + dashboard) + tokens e componenti base
riusabili da tutti gli sviluppi futuri.

## 1. Motivazione

La palette attuale (navy + cyan) non convince e non richiama il mondo automotive. I riferimenti
scelti sono [facile.it](https://www.facile.it/) (trust blue + CTA arancio, form filled-soft,
tono broker/fintech) e [autoscout24.it](https://www.autoscout24.it/) (energia automotive).

Obiettivo: allineare il look & feel a un tono da **broker professionale** (serio, affidabile),
con accenti che ricordino l'automotive, applicando lo stesso sistema a tutte le pagine esistenti
e a quelle future, così da non dover rifare restyle a ogni fase.

## 2. Direzione scelta

- **Palette "Trust Blue"** ispirata a facile.it: blu profondo come colore primario (brand,
  header, focus, link), **arancio** come CTA/urgenza. Tono serio, adatto a un servizio B2B
  che maneggia pagamenti e documenti.
- **Form "filled soft"**: campi con background azzurrino soft che diventa bianco al focus
  (più moderno e pulito dei classici input outlined).
- **Copertura**: auth + home + dashboard + design system centralizzato (tokens + componenti
  UI base riusabili).

## 3. Design tokens

Tutti i token vivono in `apps/piattaforma/src/app/globals.css` e sono esposti a Tailwind v4
via `@theme inline` con nomi semantici (`bg-pv-navy-700`, `text-pv-orange-500`, …). Nessun
colore hardcoded fuori da `globals.css`.

### 3.1 Colore

| Token | Hex | Uso |
|---|---|---|
| `--pv-navy-900` | `#0A0F1F` | testo primario, footer |
| `--pv-navy-800` | `#0A2540` | header scuro, shell auth, topbar dashboard |
| `--pv-navy-700` | `#003F8A` | brand primario, titoli card |
| `--pv-navy-600` | `#0054A6` | focus ring, link, bordo attivo |
| `--pv-navy-100` | `#E8EEF7` | background input (filled soft), tint leggero |
| `--pv-orange-500` | `#FF7A00` | CTA primario |
| `--pv-orange-600` | `#E86D00` | CTA hover |
| `--pv-slate-50` | `#F8FAFC` | body bg dashboard / home |
| `--pv-slate-100` | `#F1F5F9` | bg soft secondario |
| `--pv-slate-200` | `#E2E8F0` | bordi card |
| `--pv-slate-300` | `#CBD5E1` | bordi bottoni secondari |
| `--pv-slate-500` | `#64748B` | testo secondario |
| `--pv-slate-700` | `#334155` | label form |
| `--pv-slate-900` | `#0F172A` | testo body |
| `--pv-green-500` | `#16A34A` | successo (stepper done, alert) |
| `--pv-red-500` | `#DC2626` | errore |
| `--pv-amber-500` | `#F59E0B` | warning |

### 3.2 Radius, ombre, motion

```
--pv-radius-sm: 8px; --pv-radius-md: 10px; --pv-radius-lg: 12px;
--pv-radius-xl: 16px; --pv-radius-2xl: 20px;

--pv-shadow-card: 0 1px 2px rgb(0 0 0 / .04), 0 12px 30px rgb(10 37 64 / .08);
--pv-shadow-cta: 0 8px 18px rgb(255 122 0 / .28);
--pv-ring-focus: 0 0 0 3px rgb(0 84 166 / .22);
```

- Transizioni 120ms ease per `background/border/box-shadow`; `active:scale(.98)` ~50ms.

### 3.3 Tipografia

- Font: **Geist Sans** (già caricato via `next/font` in `app/layout.tsx`). Rimuovere il
  fallback `Arial, Helvetica, sans-serif` dal `body` (oggi sovrascrive Geist).
- Scala: `xs 12 / sm 13 / base 14 / lg 16 / xl 18 / 2xl 22 / 3xl 28 / 4xl 36` con
  weight `500 | 600 | 700 | 800`.
- Titoli card: `700/800`, navy-800.

### 3.4 Cleanup del vecchio tema

- Rimuovere le variabili `--brand-navy*`, `--brand-cyan*` e tutte le loro `@theme` mapping
  da `globals.css`.
- Rimuovere `bg-[var(--brand-...)]` e simili nei file auth — sostituire con classi
  semantiche (`bg-pv-navy-800`, `ring-pv-navy-600`, …).

## 4. Componenti UI base

Vivono in `apps/piattaforma/src/components/ui/`. Ogni pagina esistente viene rifattorizzata
per consumarli — niente più stringhe locali tipo `inputClass`, `primaryBtn`, `secondaryBtn`
copiate nel wizard.

### 4.1 `<Button />`

Props: `variant: 'primary' | 'secondary' | 'ghost' | 'danger'`, `size: 'sm' | 'md'`,
`loading?: boolean`, più tutte le prop native di `<button>`.

- **primary**: bg `pv-orange-500`, testo `#1A1A1A` (più leggibile su arancio del bianco),
  radius `10px`, padding `12px 18px`, font `14/700`, shadow `--pv-shadow-cta`.
  Hover → `pv-orange-600`. Active → `scale(.98)`. Disabled → bg `pv-slate-300`, testo
  `pv-slate-500`, no shadow.
- **secondary**: bg bianco, border `1.5px pv-slate-300`, testo `pv-navy-700`. Hover → bg
  `pv-slate-50`.
- **ghost**: trasparente, testo `pv-navy-600`, underline su hover.
- **danger**: bg `pv-red-500`, testo bianco.
- **loading**: spinner 14px a sinistra + testo "Attendi…", bottone disabilitato, cursor
  `wait`.

### 4.2 `<Input />`, `<Select />`, `<Checkbox />`, `<Label />`, `<Field />`

- `<Field label required error>{children}</Field>` wrappa label + children + messaggio errore.
- **Input / Select (stile filled soft)**: bg `pv-navy-100`, border `1.5px transparent`,
  radius `10px`, padding `12px 14px`, font `14/500`, color `pv-slate-900`, placeholder
  `pv-slate-500`.
  - Focus: bg `#fff`, border `pv-navy-600`, shadow `--pv-ring-focus`.
  - Error: border `pv-red-500` + ring rosso soft (3px rgb(220 38 38 / .22)).
  - Disabled: opacity .6, cursor `not-allowed`.
- **Label**: sopra l'input, `12.5/600`, `pv-slate-700`. Required mark: pallino arancio
  `•` dopo la label (meno stressante dell'asterisco rosso).
- **Select**: stesso styling dell'input, chevron SVG custom a destra.
- **Checkbox**: box 18px, radius 4px, border `pv-slate-300`; check in `pv-navy-700`
  (usa `accent-color` + custom SVG se serve). Testo 13px con link `pv-navy-600`
  sottolineato su hover.

### 4.3 `<Alert variant="success|error|warning|info">`

Radius 12px, padding `12px 14px`, border sottile del tono corrispondente, bg tint 50,
icona 16px a sinistra, testo 13px. Usato per success/error registrazione, banner fase 3
documenti, banner SEPA fase 5.

### 4.4 `<Stepper steps current>`

- Bubble 28px, radius full: `done` = `pv-green-500` + ✓ bianco; `current` = `pv-navy-700` +
  numero bianco + ring `rgb(0 84 166 / .20)` 4px; `todo` = `pv-slate-200` + numero
  `pv-slate-500`.
- Rail tra step: `pv-green-500` se step precedente done, altrimenti `pv-slate-200`.
- Label: mobile sotto, desktop a lato; `11/600`, colore in base allo stato.

### 4.5 `<Card />`

`bg white, border pv-slate-200 1px, radius pv-radius-xl (16px), shadow --pv-shadow-card,
padding 20px (24px ≥sm)`. Usato per welcome dashboard, trust badge home, hero panels.

## 5. Layout di pagina

### 5.1 Auth shell (`app/(auth)/layout.tsx`)

- Background: `linear-gradient(160deg, pv-navy-800 0%, pv-navy-700 55%, #01306B 100%)`
  più un `radial-gradient(1000px 500px at 30% -10%, rgb(0 84 166 / .35), transparent 60%)`
  come overlay soft. Niente più cyan spot.
- Logo box: bianco, 64px, radius 14px, shadow scura (0 10px 24px rgb(0 0 0 / .30)).
- Titolo brand: bianco, 28px/800 (32px ≥sm).
- Sottotitolo: `#B8CDEA`, 14px.
- Card auth: bianca, `radius pv-radius-xl`, shadow `--pv-shadow-card` rafforzata
  (`0 24px 60px rgba(0,0,0,.22)`), padding 24px (28px ≥sm).
- Footer: `#B8CDEA`, 12px.

### 5.2 Homepage (`app/page.tsx`)

- Topbar bianca sticky: logo PV + link "Accedi" (ghost) e "Registra" (primary small).
- Hero su bg `pv-slate-50`, padding generoso:
  - H1 `44/800 pv-navy-900` con claim attuale (rivisto tono broker).
  - Sottotitolo `18/500 pv-slate-700`.
  - Due CTA: primary arancio "Registra la tua azienda" + secondary "Accedi".
- Fascia trust: 3 Card orizzontali con icona + titolo + micro-testo (es. "Sicuro — mandato
  SEPA", "Veloce — passaggi in 48h", "Assistito — supporto dedicato").
- Footer scuro `pv-navy-900`: claim, link privacy/T&C, copyright.

### 5.3 Dashboard shell (`app/dashboard/page.tsx`)

- Topbar `pv-navy-800` fissa, 56px: logo + email utente + bottone "Esci" (ghost chiaro).
- Body bg `pv-slate-50`, padding 24px, container `max-w-6xl mx-auto`.
- Card welcome (nuovo `<Card />`): titolo "Benvenuto, {nome}" `navy-800 20/700`, meta
  `slate-500 13/500`.
- CTA primary "Nuova pratica" arancio (placeholder, diventerà attivo in Fase 2).
- Nota sotto: "Le funzionalità arriveranno nelle prossime fasi" in `slate-500 13`.

### 5.4 Wizard registrazione

- Lo stesso `<Stepper />` orizzontale in cima (4 step).
- Grid di `<Field />` con `<Input />` / `<Select />`.
- Barra bottoni in fondo: secondary "Indietro" a sinistra (auto width), primary "Avanti"
  a destra (flex-1). Mobile: `flex-col-reverse`.
- Alert success/error sopra al form.

## 6. Architettura file

```
apps/piattaforma/src/
  app/globals.css                        # tokens + reset font body
  components/ui/
    button.tsx
    input.tsx
    select.tsx
    checkbox.tsx
    label.tsx
    field.tsx
    alert.tsx
    stepper.tsx
    card.tsx
    index.ts                             # barrel export
  app/(auth)/layout.tsx                  # refactor
  app/(auth)/login/login-form.tsx        # usa ui/*
  app/(auth)/register/register-wizard.tsx
  app/(auth)/verify-email/page.tsx
  app/(auth)/reset-password/page.tsx
  app/page.tsx                           # homepage rifatta
  app/dashboard/page.tsx                 # dashboard shell + welcome card
```

## 7. Vincoli e non-obiettivi

- **Accessibilità**: tutti i componenti mantengono `label[for]` corretto, `aria-invalid`
  sui field errati, focus-ring visibile (ring-3 `--pv-navy-600`). Contrasto AA
  garantito su testo CTA (`#1A1A1A` su arancio passa AA).
- **Responsive**: tutto responsive ≥ 360px. Breakpoint Tailwind standard (`sm 640`,
  `md 768`, `lg 1024`).
- **Dark mode**: fuori scope in questa iterazione. I token sono nominati per poter
  aggiungere una mappa `@media (prefers-color-scheme: dark)` in futuro senza rinominare.
- **Non tocca**: schema Prisma, server actions, schemas Zod, rotte — cambia solo il layer
  di presentazione.
- **Non introduce**: nessuna dipendenza nuova. Niente shadcn/ui o Radix per ora — i
  componenti sono primitivi custom, sottili, senza API pubblica da versionare.
- **YAGNI**: niente `variant="link"`, niente `size="xl"`, niente theme switcher. Solo
  le varianti effettivamente usate dalle pagine esistenti.

## 8. Criteri di successo

- `globals.css` non contiene più riferimenti a `--brand-navy*` / `--brand-cyan*`.
- Grep per `bg-blue-`, `text-blue-`, `bg-slate-900` nelle pagine dà zero match (solo
  classi `pv-*`).
- Login, wizard 4-step, verify-email, reset-password, home e dashboard caricano senza
  errori e rispecchiano i mockup approvati (Trust Blue + filled soft).
- Lint e typecheck puliti (`pnpm -F piattaforma lint && pnpm -F piattaforma typecheck`).
- Build Next.js passa (`pnpm -F piattaforma build`).

## 9. Fuori scope (future-work)

- Dark mode.
- Micro-interactions avanzate (framer-motion su wizard step-change).
- Libreria di icone unificata (per ora le tre icon della home sono SVG inline).
- Screenshot / Storybook dei componenti UI.
