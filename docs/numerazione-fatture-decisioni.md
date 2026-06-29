# Verbale decisioni — Numerazione Fatture Passaggio Veloce

> **Owner:** CTO Francesco Sioli  
> **Data decisioni:** 2026-06-29  
> **Riferimento piano:** `docs/superpowers/plans/2026-06-29-numerazione-fatture.md`  
> **Spec tecnica:** `docs/sistema-fatturazione.md` §2 (dec. 5), §3.1, §6.5

---

## Contesto

Il documento `docs/PassaggioVeloce NumerazioneFatture.docx` (aprile 2025, redatto prima dello sviluppo) descriveva un sistema di numerazione fiscale con:
- sequenza continua senza reset annuale ("mai azzerata");
- granularità per sotto-account (una sequenza per ogni utente/sede, non per P.IVA unica).

Il sistema di fatturazione è stato implementato nel giugno 2026 (bundle FT-A..D) in un contesto in cui:
- era già stato adottato il modello **multi-sede** (una `Company` per P.IVA + N `Sede`);
- la tabella contatori doveva garantire atomicità senza race condition in ambiente serverless;
- le note di credito richiedevano un registro separato per chiarezza fiscale.

Le decisioni sotto **sostituiscono** le indicazioni del `.docx` originale nei punti in conflitto. Il `.docx` rimane in `docs/` come documento di riferimento storico ma non è più la source-of-truth sulla numerazione.

---

## Decisioni fissate (Francesco Sioli, CTO — 2026-06-29)

### D-1 Schema ibrido: prefisso + ID soggetto + reset annuale

**Formato adottato:**

| Tipo documento | Formato numero | Esempio |
|---|---|---|
| Fattura PV → agenzia | `PV-<anno>-NNNNN` | `PV-2026-00001` |
| Documento broker (conto terzi) | `PV-<id4>-<anno>-NNNNN` | `PV-0047-2026-00003` |
| Nota di credito PV | `NC-<anno>-NNNNN` | `NC-2026-00001` |
| Nota di credito broker | `NC-<id4>-<anno>-NNNNN` | `NC-0047-2026-00002` |
| Penale (fuori scope paper) | `PN-[<id4>-]<anno>-NNNNN` | `PN-2026-00001` |

- `<id4>` = `Company.numeroSoggetto` zero-pad 4 cifre (es. broker con `numeroSoggetto=47` → `0047`).
- `NNNNN` = progressivo zero-pad 5 cifre.
- `<anno>` = anno solare (reset a ogni 1° gennaio).

**Divergenza dal `.docx`:** il paper prevedeva sequenza continua senza anno nel numero e senza reset. La scelta del reset annuale è coerente con la prassi contabile italiana e semplifica la ricerca per esercizio fiscale.

### D-2 Granularità per azienda madre (Company, P.IVA unica)

Il numero soggetto (`Company.numeroSoggetto`) è assegnato sulla **Company** (P.IVA unica), non sulla singola Sede. I contatori progressivi sono anch'essi per Company, indipendentemente dal numero di Sedi.

**Divergenza dal `.docx`:** il paper ipotizzava sequenze per "sotto-account" (potenzialmente per sede). Con il modello multi-sede già in produzione (una Company, N Sedi), la granularità per Company è l'unica coerente con la P.IVA unica e con la logica di emissione dei documenti fiscali.

Eventuale tracciabilità per-sede nel numero documento è rimandata a evoluzione futura come campo informativo aggiuntivo, non come parte della numerazione fiscale.

### D-3 Note di credito su sequenza separata

Le note di credito (tipo `NOTA_VARIAZIONE` nel DB, `NOTA_CREDITO` nell'enum `ContatoreFiscaleTipo`) utilizzano un registro distinto: la chiave del contatore è `(idSoggetto, NOTA_CREDITO, anno)`, separata da `(idSoggetto, FATTURA_PV, anno)` e `(idSoggetto, DOC_BROKER, anno)`.

**Razionale:** evita che la numerazione delle fatture "salti" quando viene emessa una nota di credito; rende immediatamente riconoscibili le note per prefisso (`NC-`); è la prassi comune nel registro IVA italiano.

---

## Implementazione tecnica

- **`Company.numeroSoggetto`**: `Int @unique`, assegnato da Postgres `SEQUENCE numero_soggetto_seq`. Mai riusato nemmeno alla chiusura dell'account.
- **`ContatoreFiscale`** (tabella `contatori_fiscali`): chiave `(idSoggetto, tipoDocumento, anno)`. Incremento atomico via `INSERT … ON CONFLICT … DO UPDATE … RETURNING` eseguito dentro la stessa `prisma.$transaction` della create del documento. Se la create fallisce, il numero fa rollback: nessun buco nella sequenza.
- **`DocumentoFiscale.numeroDocumentoStr`**: stringa formattata congelata all'emissione (es. `PV-0047-2026-00003`). UI, PDF e XML la leggono da questo campo; non ricalcolano il formato a runtime (immutabilità fiscale).
- **PV emittente**: `idSoggetto = 'PV'` (costante letterale), non una Company separata.
- Migration: `numerazione_paper` (giugno 2026) — rimuove `Company.numeratoreFiscaleAnno` e `Company.numeratoreFiscaleNum`, crea `contatori_fiscali`, crea `numero_soggetto_seq`, backfilla `Company.numeroSoggetto` e `DocumentoFiscale.numeroDocumentoStr` sui dati storici.

---

## Punti aperti per il commercialista (non bloccanti per lo sviluppo)

1. **Legittimità del reset annuale sul registro broker conto terzi** — confermare che il registro dei documenti emessi da PV per conto del broker (sequenza `DOC_BROKER`) possa azzerarsi a inizio anno come il registro proprio PV. In caso contrario, è sufficiente rimuovere `anno` dalla chiave del contatore per quel `tipoDocumento` (modifica localizzata a `prossimoContatore` + migration).

2. **Uso del prefisso `PV-` su documenti il cui emittente fiscale è il broker** — il numero `PV-0047-2026-00003` è il numero di sequenza nel registro tenuto da Passaggio Veloce per conto del broker; il `CedentePrestatore` nell'XML FatturaPA resta il broker. Confermare che il prefisso commerciale `PV-` su questi documenti non crei ambiguità con i numeri propri del broker o con i requisiti SDI.

---

## Documenti superati (o parzialmente superati) da queste decisioni

| Documento | Sezione | Superamento |
|---|---|---|
| `docs/PassaggioVeloce NumerazioneFatture.docx` (apr 2025) | Intero documento | Sostituito da queste decisioni per formato, reset e granularità. Conservato come riferimento storico. |
| `docs/sistema-fatturazione.md` §2 decisione 5 (redazione precedente) | "Distinti registri: uno per PV, uno per ogni broker" | Sostituito con la descrizione del formato ibrido (§2 decisione 5 aggiornata). |
| `docs/sistema-fatturazione.md` §6.5 (pseudocodice SELECT FOR UPDATE) | pseudocodice con `Company.numeratoreFiscaleNum` | Sostituito con il pattern `ON CONFLICT` e tabella `contatori_fiscali`. |

---

## Checklist pre-deploy prod (migration `numerazione_paper`) — GATE OBBLIGATORIO

La migration è stata validata in locale solo su **DB vuoto** (`prisma migrate reset`). Il path di backfill su **companies popolate** (assegnazione `numeroSoggetto` via `ROW_NUMBER`, `setval`, `SET NOT NULL`, e backfill `numeroDocumentoStr` sui documenti storici) **non è stato esercitato su dati di forma prod**. Prima di `migrate deploy` in prod:

1. **Conta documenti esistenti:** `SELECT count(*) FROM documenti_fiscali;` su prod. Se > 0, verificare con il commercialista la coerenza dei numeri storici riformattati (la migration li riscrive col nuovo formato mantenendo il progressivo storico). Se esistono note di credito broker storiche, confermare che la nuova chiave `(broker, NOTA_CREDITO, anno)` riparta sopra il loro max (garantito dal seed simmetrico Step 5).
2. **Dry-run su Neon branch prod-shaped:** applicare la migration su un branch Neon (companies reali presenti) e verificare:
   - `SELECT count(*) FROM companies WHERE "numeroSoggetto" IS NULL;` → **0**
   - `SELECT count(*) FROM documenti_fiscali WHERE "numeroDocumentoStr" IS NULL;` → **0**
   - `SELECT "numeroSoggetto", count(*) FROM companies GROUP BY 1 HAVING count(*) > 1;` → **0 righe** (univocità)
3. Solo dopo l'esito pulito del dry-run: `prisma migrate deploy` sul DB prod Neon (`ep-solitary-night`).

## Backlog minori (differiti dalla final review — non bloccanti)

- **M1** — `Company.numeroSoggetto @default(dbgenerated("nextval('numero_soggetto_seq')"))` senza `::regclass`; possibile drift benigno su `migrate dev` (prod usa `migrate deploy`).
- **M-d** — `contatori_fiscali.aggiornatoAt` ha `DEFAULT CURRENT_TIMESTAMP` nel DDL ma `@updatedAt` nello schema: stesso tipo di drift benigno.
- **M3** — le select `notaVariazionePer` in `xml/route.ts` e `documento-pdf.ts` fetchano `numeroProgressivo`/`anno` ora inutilizzati.
- **M-b** — la ricerca in `fatturazione/page.tsx` / `admin/fatturazione/page.tsx` filtra per `numeroProgressivo` (intero), mentre l'utente vede `PV-2026-00001`: la ricerca sulla stringa completa non matcha.
- **M-c** — `documento-pdf.ts` costruisce il filename PDF da `numeroProgressivo-anno`, non da `numeroDocumentoStr` (cosmetico).
- **M-e** — `numeroDocumentoStr` resta nullable: il backfill copre tutti i tipi, si potrebbe stringere a `NOT NULL` per irrobustire l'invariante.
- **M-f** — il backfill formatta i `PENALE_BROKER` come `PN-<anno>-…` senza `id4`, mentre `format.ts` aggiungerebbe l'`id4`: incoerente ma inerte (nessun path di creazione penali oggi).
