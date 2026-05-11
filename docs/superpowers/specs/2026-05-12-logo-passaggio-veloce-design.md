# Logo Passaggio Veloce — Brand kit SVG

**Data:** 2026-05-12
**Stato:** approvato dopo iterazione visual companion

## Obiettivo

Creare il logo ufficiale di Passaggio Veloce in formato SVG (vettoriale, scalabile, leggero) declinato in tutte le varianti necessarie per app web, materiale di stampa, social, favicon e fatture. Il logo deve trasmettere:

- **Identità del prodotto:** broker digitale per passaggi di proprietà veicoli → riferimento al documento di passaggio
- **Promessa di velocità:** il fulmine che attraversa il documento racconta l'istantaneità del servizio
- **Coerenza visiva col sito:** palette Trust Blue identica a quella usata nella piattaforma

## Concept finale

**Icona — "Documento attraversato dal fulmine":**
- Foglio rettangolare con angolo piegato in alto a destra (richiamo a documento ufficiale / certificato)
- Tre righe orizzontali interne che evocano il testo del documento
- Fulmine arancio centrale, bordato col colore del documento, che taglia diagonalmente il foglio
- Rapporto fulmine/documento studiato per restare leggibile fino a 16×16 px (favicon)

**Wordmark — "PassaggioVeloce":**
- Font: **Inter** (stesso del sito), peso **900** (Black)
- **Italic + skew −6°** per accentuare il senso di movimento
- Letter-spacing −0.025em (tracking stretto)
- Le due parole sono attaccate (nessuno spazio): "Passaggio" navy + "Veloce" arancio funzionano come parola visiva unica
- Nel file SVG il testo è generato con elemento `<text>` + `font-family="Inter, …system fallback"`: la piattaforma carica Inter globalmente, quindi sul web la resa è garantita. Per uso stampa è previsto un follow-up con SVG "outlined" (glyph → path) generato con tool esterno (`fontTools`, Inkscape CLI) — fuori scope qui

**Lockup orizzontale:**
- Icona a sinistra, wordmark a destra
- Allineamento verticale: centro della bounding box dell'icona allineato al centro del cap-height del testo
- Gap icona ↔ testo: **4 px** (gap stretto: testo e icona sono visivamente un singolo blocco)
- Altezza testo ≈ 70% dell'altezza icona

## Palette

Token color presi da `apps/piattaforma/src/app/globals.css` — nessun nuovo colore introdotto:

| Ruolo | Token | Hex |
|---|---|---|
| Documento (primary) | `--pv-navy-800` | `#0a2540` |
| Ombra/cap angolo piegato | `--pv-navy-700` | `#003f8a` |
| Righe testo (su navy) | `--pv-navy-100` | `#e8eef7` |
| Fulmine / "Veloce" | `--pv-orange-500` | `#ff7a00` |
| Sfondo light | `--pv-slate-50` | `#f8fafc` |
| Stampa B/N positiva | navy puro | `#0a2540` |

## File da produrre

Tutti i file vivono in `apps/piattaforma/public/brand/`. Struttura:

```
apps/piattaforma/public/brand/
├── logo-primary.svg          # Lockup orizzontale, colori, per sfondo chiaro
├── logo-dark.svg             # Lockup orizzontale, per sfondo navy (header/footer scuri)
├── logo-mono-white.svg       # Lockup monocromatico bianco, per sfondo arancio o foto
├── logo-mono-navy.svg        # Lockup monocromatico navy, per stampa B/N, PDF, fatture
├── icon.svg                  # Solo icona, colori, per app icon / avatar (64+ px)
├── icon-mono-white.svg       # Icona mono bianca (favicon su sfondo scuro)
├── icon-mono-navy.svg        # Icona mono navy (favicon B/N)
└── favicon.svg               # Icona semplificata (no righe testo), ottimizzata 16×16
```

**Specifiche tecniche per ogni SVG:**
- `viewBox` impostato sul bounding box reale dell'arte (no padding interno)
- Attributi `xmlns="http://www.w3.org/2000/svg"` + `role="img"` + `<title>` per accessibilità
- File ottimizzati a mano: niente metadati Inkscape/Illustrator, niente attributi inutilizzati, niente stili inline esprimibili come attributo
- Lockup con testo: elemento `<text>` con `font-family="Inter, 'Helvetica Neue', Arial, sans-serif"`, `font-weight="900"`, `font-style="italic"`, applicazione di `transform="skewX(-6)"` sul gruppo testo
- File icon-only: niente `<text>`, solo path → autosufficienti senza font

## Utilizzo nella piattaforma (out of scope per questo spec, ma indicativo)

Sostituzione di `logo-passaggio-veloce.png` e references attuali con i nuovi SVG nei punti dove il logo viene mostrato:

- `AppShell` topbar → `logo-dark.svg` (header navy)
- Marketing home / pagine auth → `logo-primary.svg`
- Email transazionali Resend → `logo-primary.svg`
- Fatture PDF → `logo-mono-navy.svg`
- `<link rel="icon">` → `favicon.svg` + fallback `favicon.ico` da generare
- App icon iOS/Android (se PWA) → `icon.svg` esportato in PNG 192/512

Lo swap nei punti d'uso esistenti sarà gestito in un commit separato dopo la generazione dei file.

## Versionamento

Una volta committati, i file SVG diventano la **single source of truth** del brand. Modifiche future al logo devono passare da un nuovo spec (`docs/superpowers/specs/YYYY-MM-DD-logo-…-design.md`) per mantenere lo storico delle iterazioni di brand.

## Non in scope

- Generazione PNG/ICO per favicon legacy (servirà un passo successivo con tool tipo `sharp`)
- Generazione SVG "outlined" con path al posto di `<text>` per uso stampa (richiede font tooling esterno)
- Animazioni del logo (loader, micro-interaction)
- Brand book completo (linee guida tipografia, spaziature minime, esempi d'uso vietati)

## Swap nei punti d'uso (incluso su richiesta utente 2026-05-12)

Dopo aver generato gli SVG, sostituire i riferimenti al logo esistente in tutti i punti d'uso identificati (vedi sezione "Utilizzo nella piattaforma" sopra). Ogni gruppo logico di sostituzioni va in un commit dedicato per facilitare review/rollback.

## Riferimenti

- Spec design system: `docs/superpowers/specs/2026-04-16-restyle-automotive-design.md`
- Token palette: `apps/piattaforma/src/app/globals.css`
- Mockup HTML iterati: `.superpowers/brainstorm/58457-1778539490/content/` (icon-concept, typography, lockup-refine, final-preview, final-preview-v2)
