# Tipologia pratica multipla — voce in fattura + chip tipologia ovunque

**Data:** 2026-07-11
**Aree:** fatturazione (`lib/fatturazione/descrizione.ts` + include), viste pratica-centriche.

## Obiettivo

1. **Fattura**: nella voce `FATTURA_PV` "Servizio di intermediazione per passaggio di proprietà", per una pratica **multipla** aggiungere `multiplo (N veicoli)`. Pratica singola invariata.
2. **Tipologia ovunque**: in ogni vista pratica-centrica (liste, card, dettaglio) mostrare un **chip** con la tipologia: `Semplice` / `Semplice Multiplo` / `Minivoltura` / `Minivoltura multipla`.

## Modello dati

`Pratica.tipo: PraticaTipo` (`SEMPLICE | MINIVOLTURA`) e `Pratica.numeroVeicoli: Int` sono **ortogonali**: "multiplo" = `numeroVeicoli > 1`, indipendente dal tipo (vale sia per SEMPLICE sia per MINIVOLTURA). Il commento a `schema.prisma:720` ("1 per SEMPLICE, ≥2 per MINIVOLTURA") è datato e fuorviante — NON è la fonte di verità.

Mappa etichette (verbatim come richiesto dall'utente, capitalizzazione inclusa):

| tipo | numeroVeicoli | etichetta |
|---|---|---|
| SEMPLICE | ≤ 1 | `Semplice` |
| SEMPLICE | > 1 | `Semplice Multiplo` |
| MINIVOLTURA | ≤ 1 | `Minivoltura` |
| MINIVOLTURA | > 1 | `Minivoltura multipla` |

## Decisioni (confermate con l'utente)

- **Fattura (item 1)**: testo `Servizio di intermediazione per passaggio di proprietà multiplo (N veicoli)` per multiplo; singolo invariato. Solo `FATTURA_PV` (non `DOC_BROKER`/altri).
- **Centralizzazione (item 2)**: un unico helper `labelTipoPratica` con le 4 etichette brevi, usato **ovunque, dettaglio incluso** → sostituisce il `labelTipo` locale lungo di `pratiche/[id]/page.tsx` ("Passaggio di proprietà semplice (multiplo, N veicoli)").
- **Presentazione**: **chip/badge** dedicato (stile design system, come `StatusChip`), anche sulla pagina dettaglio (sostituisce il testo attuale accanto al comune).
- **Scope**: SOLO viste pratica-centriche (sotto). NON i contesti finanziari/documentali che citano solo il codice pratica.

## Architettura

### Item 1 — voce in fattura

- `lib/fatturazione/descrizione.ts`:
  - Estendere `DescrizioneDoc.pratica` con `numeroVeicoli?: number` (opzionale → i fixture/documenti senza il campo restano validi e ricevono l'etichetta singola).
  - Nel ramo `FATTURA_PV`: `const n = doc.pratica?.numeroVeicoli ?? 1; descrizione = n > 1 ? 'Servizio di intermediazione per passaggio di proprietà multiplo (' + n + ' veicoli)' : 'Servizio di intermediazione per passaggio di proprietà';`
- Include (entrambi devono fornire `numeroVeicoli`):
  - `lib/fatturazione/documento-pdf.ts` → `documentoPdfInclude.pratica.select`: aggiungere `numeroVeicoli: true`.
  - `app/api/fatturazione/[id]/xml/route.ts` → include `pratica.select`: aggiungere `numeroVeicoli: true`.
- Test: nuovo `lib/fatturazione/descrizione.test.ts` (TDD) per il ramo `FATTURA_PV` singolo vs multiplo (e che gli altri tipi non cambino). I test PDF/XML esistenti passano `descrizione` come input diretto → non si rompono (il campo è opzionale, nessun fixture obbligato ad aggiungerlo).

### Item 2 — helper + chip + superfici

- `lib/pratiche/label-tipo.ts` (puro): `labelTipoPratica(p: { tipo: PraticaTipo; numeroVeicoli: number }): string` con la mappa sopra. + `label-tipo.test.ts` (4 casi + numeroVeicoli 0/1 → singolo).
- `components/ui/tipo-pratica-chip.tsx`: `TipoPraticaChip({ tipo, numeroVeicoli })` — piccolo chip che rende `labelTipoPratica`, classi `pv-*` (mirror di `StatusChip`). Un unico stile; il testo distingue già singolo/multiplo. **Esportato dal barrel `@/components/ui`** (dove sta `StatusChip`), così le superfici lo importano con `import { TipoPraticaChip } from '@/components/ui'`.
- Sostituire il `labelTipo` locale di `pratiche/[id]/page.tsx` con il chip (rimuovere la funzione locale).
- Applicare `<TipoPraticaChip tipo numeroVeicoli />` accanto al codice pratica nelle superfici sotto, aggiungendo `tipo` e `numeroVeicoli` alle rispettive query `select`/`include` dove mancano.

**Superfici IN scope (8):**
- `app/pratiche/page.tsx` — lista pratiche (agenzia + broker)
- `app/pratiche/[id]/page.tsx` — dettaglio (sostituzione label)
- `app/inbox/page.tsx` — lista inbox (assegnazioni → pratica)
- `app/inbox/[id]/page.tsx` — dettaglio inbox
- `app/dashboard/agenzia-dashboard.tsx` — card pratiche recenti/assegnazioni
- `app/dashboard/broker-dashboard.tsx` — card pratiche recenti
- `app/admin/pratiche/page.tsx` — lista admin
- `app/admin/escalation/page.tsx` — lista escalation

Per ciascuna: verificare che `pratica.tipo` e `pratica.numeroVeicoli` siano nel `select`/`include` (nelle liste basate su `praticaAssegnazione`, il campo va nel nested `pratica.select`). Dove il layout della riga è una tabella a griglia (es. `admin/pratiche`), inserire il chip in una cella o accanto al codice senza rompere `PRATICHE_GRID`.

**Superfici OUT (confermate):** addebiti, wallet, feedback, fatturazione (+admin), admin/affiliazioni, admin/segnalazioni.

## Edge cases

- `numeroVeicoli` mancante/0/1 → etichetta singola (`Semplice`/`Minivoltura`); fattura invariata.
- Bozze: `numeroVeicoli` default 1 → singolo. Il chip appare comunque (mostra il tipo).
- Note di variazione / storni (`NOTA_VARIAZIONE`): la descrizione NON cambia (item 1 tocca solo `FATTURA_PV`).
- Il chip non deve rompere le griglie tabellari esistenti (larghezze `PRATICHE_GRID`).

## Testing

- `label-tipo.test.ts`: 4 combinazioni + numeroVeicoli 0/1.
- `descrizione.test.ts`: `FATTURA_PV` singolo vs multiplo (con `numeroVeicoli` 1/3), + un tipo non-FATTURA invariato.
- Suite piena verde; lint 0; typecheck ok.
- Verifica sul DB locale (read-only): esiste almeno una pratica con `numeroVeicoli > 1` (SEMPLICE e/o MINIVOLTURA) per confermare che chip e voce fattura hanno dati reali; altrimenti nota nel report.
- Smoke a fine fase: chip visibile e corretto nelle 8 superfici (singolo e multiplo); PDF/XML fattura di una pratica multipla riporta "multiplo (N veicoli)".

## Fuori scope (YAGNI)

- Chip nei contesti finanziari/documentali (addebiti, wallet, fatture, affiliazioni, segnalazioni).
- Cambiare la descrizione di `DOC_BROKER` o altri tipi documento.
- Ricalcoli economici/tariffe (già per-veicolo, non toccati).
- Filtri/ordinamenti per tipologia nelle liste.
