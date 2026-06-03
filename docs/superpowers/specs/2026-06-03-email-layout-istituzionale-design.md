# Restyle layout email istituzionale — Design

**Data:** 2026-06-03
**Stato:** approvato (brainstorming)
**Contesto:** Resend è ora agganciato in prod (email reali attive). Le notifiche usano un wrapper condiviso `wrap()` in `apps/piattaforma/src/lib/notifiche/templates.ts` con header (banda navy + logo SVG inline + wordmark) e footer minimale. Va reso più bello e istituzionale, mantenendo i corpi messaggio.

## Obiettivo

Rifare **header e footer condivisi** delle email transazionali → tutti i ~28 template ne beneficiano automaticamente. Direzione visiva scelta: **"Banda istituzionale"** (evoluzione dell'attuale, basso rischio).

## Problemi attuali da risolvere

1. **`display:flex` nell'header** → non supportato da Outlook (motore Word). Passare a layout **table-based**.
2. **Logo SVG inline** → Gmail/Outlook strippano l'SVG; il logo non si vede. Servire un **PNG ospitato** a URL assoluto.
3. **Footer minimale** (una riga) → footer istituzionale completo.

## Architettura & blast radius

- Nuovo modulo `apps/piattaforma/src/lib/notifiche/layout.ts`:
  - `emailLayout(bodyHtml: string): string` — wrapper table-based (outer full-width + table 600px centrata, header, keyline, card, footer).
  - `ctaButton(href: string, label: string): string` — bottone "bulletproof" arancio riusabile.
  - blocchi interni `emailHeader`, `emailFooter`.
- `wrap(body)` in `templates.ts` **delega** a `emailLayout(body)` → **firma invariata**, nessuna modifica ai 28 template (rischio minimo).
- Dati legali/contatti centralizzati estendendo `apps/piattaforma/src/lib/seo/brand.ts` (già single-source per `shortName`/`legalName`/`url`): aggiungere `piva`, `sede`, `supportEmail`, `tel`. Il footer li consuma da lì.

## Struttura HTML (compatibile Outlook/Gmail)

- Outer `<table>` full-width, sfondo `#f1f5f9` (slate-100), padding 20px.
- Inner `<table align="center" width="600">` (max 600px).
- **Header**: `<td>` sfondo navy `#0a2540`, padding 16px 24px, logo a sinistra, `border-radius:12px 12px 0 0`.
- **Keyline**: riga `<td>` altezza 3px sfondo arancio `#ff7a00`.
- **Card body**: `<td>` sfondo `#ffffff`, bordi laterali 1px `#e2e8f0`, padding 24px. Il body dei template (titoli, paragrafi, box semantici) resta **invariato**.
- **Footer**: `<td>` sfondo `#f8fafc`, bordo 1px `#e2e8f0` (no top), `border-radius:0 0 12px 12px`, padding 18px 24px, testo centrato.

## Logo email

- Generare `apps/piattaforma/public/brand/logo-email.png` — versione **logo standard adattata al fondo navy**: contorno documento bianco + **linee documento arancio `#ff7a00`** + **saetta arancio** + wordmark **"Passaggio" bianco / "Veloce" arancio** (NON il mono tutto bianco). Sorgente: nuovo `logo-email.svg` rasterizzato a PNG **@2x** (es. altezza reale 56–64px, mostrato a `height:28px`).
- Riferito via URL **assoluto** basato su `BRAND.url`: `https://passaggioveloce.it/brand/logo-email.png`.
- `alt="Passaggio Veloce"` come fallback se le immagini sono disattivate.

## CTA

- `ctaButton`: tabella "bulletproof", sfondo arancio `#ff7a00`, testo scuro `#1a1a1a`, weight 700, radius 8px (regola design system: CTA arancio testo scuro).
- Link inline restano blu `#0054a6`.
- Unico cambiamento a un template esistente: il bottone di **N31** passa da blu ad arancio (via `ctaButton`).

## Footer istituzionale (valori esatti)

Testo centrato, gerarchia su più righe:

```
Passaggio Veloce SRL · P.IVA 14688390963
Via delle Querce 5 — 20057 Assago (MI)
assistenza@passaggioveloce.it · +39 346 287 7310
passaggioveloce.it
[ Non vuoi più ricevere queste email? Disiscriviti · Preferenze ]
```

- La riga **disiscrizione/preferenze** è renderizzata SOLO per le notifiche opzionali (`OPTIONAL_TIPI`), come oggi gestito da `send.ts`. Va integrata DENTRO il footer (separatore `border-top` 1px, stessi colori) invece di apparire appiccicata dopo l'email.
- `send.ts` oggi appende la riga unsubscribe dopo `content.html`. Adeguare in modo che la riga finisca nel blocco footer e aggiungere anche il link **"Preferenze"** (`/profilo/notifiche`) accanto a "Disiscriviti". Mantenere invariata la logica gating (solo `OPTIONAL_TIPI`, token lazy, record SKIPPED).

## Tocchi di qualità

- **Preheader** nascosto (testo anteprima inbox) opzionale: `emailLayout` accetta un secondo parametro opzionale `preheader?`; default omesso. (YAGNI: non cablato nei singoli template ora, solo supporto.)
- Versione **testuale** (`text`) dei template: **invariata**.
- Colori scelti per restare leggibili anche in dark-mode dei client.

## Testing

- Unit test su `layout.ts`: `emailLayout` produce struttura table-based con header/keyline/card/footer; footer contiene i dati legali da `brand.ts`; URL logo e link assoluti; `ctaButton` rende ancora corretta con escaping di href/label.
- Test di non-regressione: `wrap()` continua a ritornare HTML valido e i template esistenti compilano (snapshot leggero su 2-3 template).
- **Preview HTML** rigenerato (`email-preview.html`, usa-e-getta) per validazione visiva.
- **Invio reale** via Resend di un template col nuovo layout a `assistenza@passaggioveloce.it` prima del deploy.

## Fuori scope

- Nessuna modifica ai copy dei messaggi (resta blocco B7 sales).
- Nessun redesign dei box semantici interni (verde/rosso/info) — restano com'è.
- Social nel footer: esclusi (decisione utente).
- Preheader per-template: solo supporto infrastrutturale, non popolato ora.

## Deploy

- Migrazione DB: nessuna.
- Asset: aggiungere `logo-email.png` (+ `logo-email.svg` sorgente) in `public/brand/` → servito staticamente (no env). URL su dominio `passaggioveloce.it` (custom domain già live).
- Rilascio: commit su `main` → push (deploy Vercel automatico), come da [[project-prod-release-process]].
