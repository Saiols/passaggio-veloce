# Tipi pratica (semplice/minivoltura) + multi-veicolo — Design

**Data:** 2026-06-05
**Autore:** Francesco Sioli (CTO) + Claude
**Stato:** approvato (design)

## Goal

Rivedere la creazione pratica secondo la tassonomia di dominio: **passaggio di proprietà semplice** (acquirente privato) vs **minivoltura** (acquirente commerciante d'auto), ciascuno in variante **singola** (1 veicolo) o **multipla** (n veicoli). Introdurre la cattura reale di **n veicoli/libretti** per pratica.

## Conoscenza di dominio (vedi [[project-tipi-pratica]])
- **Semplice** = chi acquista è un **privato**.
- **Minivoltura** = chi acquista è un **commerciante d'auto** (operatore auto).
- **Singolo** = 1 libretto/auto · **Multiplo** = n libretti/auto.
- Le 4 opzioni da presentare: (1) passaggio semplice, (2) passaggio semplice multiplo, (3) minivoltura singola, (4) minivoltura multipla.

## Decisioni acquisite
1. Cattura completa di **n veicoli** ora (modello `Veicolo` dedicato).
2. Pricing attuale **scalato per veicolo**.
3. Campi veicolo denormalizzati **rimossi** da `Pratica` → single source of truth = `Veicolo[]`.
4. Per **MINIVOLTURA** l'acquirente è **operatore auto** (con visura, come un'azienda).
5. Max **50** veicoli per pratica.

---

## 1. Modello dati (Prisma)

### 1.1 Enum `PraticaTipo`
```prisma
enum PraticaTipo {
  SEMPLICE     // acquirente privato (ex PASSAGGIO_PRIVATO)
  MINIVOLTURA  // acquirente commerciante d'auto (ex MINIVOLTURE_MULTIPLE)
}
```
"singolo vs multiplo" NON è nell'enum: deriva da `numeroVeicoli` (1 = singolo, >1 = multiplo).

### 1.2 Nuovo modello `Veicolo`
```prisma
model Veicolo {
  id                   String    @id @default(uuid()) @db.Uuid
  praticaId            String    @db.Uuid
  pratica              Pratica   @relation(fields: [praticaId], references: [id], onDelete: Cascade)
  ordine               Int       // 1..n, ordine di inserimento
  targa                String?
  telaio               String?
  proprietarioAttuale  String?
  dataImmatricolazione DateTime?
  preImm2015           Boolean   @default(false)
  flagComodatoDuso     Boolean   @default(false)
  ocrData              Json?
  ocrProvider          String?
  ocrAt                DateTime?
  documenti            Documento[]  @relation("DocumentiVeicolo")
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  @@index([praticaId])
  @@map("veicoli")
}
```

### 1.3 `Pratica` (modifiche)
- **Rimuovere** i campi denormalizzati: `targa`, `telaio`, `proprietarioAttuale`, `dataImmatricolazione`, `preImm2015`, `flagComodatoDuso`.
- **Mantenere** `numeroVeicoli Int @default(1)`.
- **Aggiungere** relazione `veicoli Veicolo[]`.
- `flagMinivoltura` esistente: derivabile da `tipo === 'MINIVOLTURA'`; lo manteniamo allineato (set al submit) per non rompere consumatori, oppure lo deprechiamo — **scelta: mantenerlo allineato** (`flagMinivoltura = tipo === 'MINIVOLTURA'`).

### 1.4 `Documento` (modifica)
- Aggiungere `veicoloId String? @db.Uuid` + relazione `veicolo Veicolo? @relation("DocumentiVeicolo", ...)`. Il libretto di ciascun veicolo punta al `Veicolo`; i documenti delle parti restano legati alla `Pratica` (come oggi).

### 1.5 Migration (prod manuale, vedi [[project-prod-release-process]])
- Rename enum values: `PASSAGGIO_PRIVATO`→`SEMPLICE`, `MINIVOLTURE_MULTIPLE`→`MINIVOLTURA` (`ALTER TYPE ... RENAME VALUE`).
- `CREATE TABLE veicoli` + `ALTER TABLE documenti ADD COLUMN veicoloId` + FK/index.
- **Data-migration**: per ogni `Pratica` esistente creare 1 `Veicolo` (ordine 1) copiando i campi denormalizzati; collegare il `Documento` LIBRETTO_CIRCOLAZIONE della pratica al nuovo veicolo (`veicoloId`).
- **Dopo** la copia, `ALTER TABLE pratiche DROP COLUMN targa, telaio, ...`.
- Le `ALTER TYPE ... RENAME VALUE` e i DROP COLUMN sono operazioni Postgres supportate; ordine: rename enum → create veicoli → backfill → add documenti.veicoloId → backfill libretto → drop colonne pratica.

---

## 2. Pricing (`apps/piattaforma/src/lib/pricing.ts`)
`computeFees({ tipo, numeroVeicoli })` ritorna fee per veicolo ×n:
- **SEMPLICE**: per veicolo → `feeAgenziaCent=7500`, `creditoBrokerCent=2500`, `ricavoLordoCent=5000`, `costoAffiliazioneTotaleCent=1000`; totali = ×`numeroVeicoli`.
- **MINIVOLTURA**: per veicolo → `feeAgenziaCent=1500`, `creditoBrokerCent=0`, `ricavoLordoCent=1500`, `costoAffiliazioneTotaleCent=500`; totali = ×`numeroVeicoli`.
- Validazione: `numeroVeicoli >= 1` (SEMPLICE singola ammessa = 1; multipla = >1). Rimuovere i vincoli vecchi (privato==1, minivolture>=2).
Aggiornare `pricing.test.ts` ai 4 casi (semplice 1, semplice n, minivoltura 1, minivoltura n).

---

## 3. UI wizard (`apps/piattaforma/src/app/pratiche/nuova/wizard.tsx`)

### 3.1 Step Tipo — 4 card
Card con i nomi esatti (mappano su `(tipo, multiplo)`):
1. **Passaggio di proprietà semplice** → `SEMPLICE`, singolo (numeroVeicoli=1)
2. **Passaggio di proprietà semplice multiplo** → `SEMPLICE`, multiplo
3. **Minivoltura singola** → `MINIVOLTURA`, singolo
4. **Minivoltura multipla** → `MINIVOLTURA`, multiplo
Per le varianti multiple, input `numeroVeicoli` (min 2, max 50). Per le singole, `numeroVeicoli=1` fisso.

### 3.2 Sezione veicoli ripetuta
Per ciascun veicolo (1..numeroVeicoli): upload libretto + `extractLibrettoAction` + campi correggibili (targa, telaio, proprietario, data immatricolazione, preImm2015, flagComodatoDuso). Stato wizard: `veicoli: VeicoloInput[]`. Aggiunta/rimozione veicolo coerente con `numeroVeicoli`.

### 3.3 Parti
Venditore: tipi soggetto come oggi. Acquirente: se `tipo === 'MINIVOLTURA'` l'acquirente è **operatore auto** (mostra/forza `OPERATORE_AUTO` con visura); se `SEMPLICE`, tipi soggetto privati/azienda (no operatore auto), come oggi.

---

## 4. Engine documenti (`apps/piattaforma/src/lib/documenti/engine.ts`)
`calcolaDocumentiRichiesti` lavora oggi su un singolo veicolo (preImm2015/comodato) + parti. Estensione:
- Input passa da campi singoli a **lista veicoli**; per ciascun veicolo: `LIBRETTO_CIRCOLAZIONE` (parte AZIENDA/veicolo) + se `preImm2015` → `CERTIFICATO_PROPRIETA`; blocco se `flagComodatoDuso` su qualunque veicolo.
- Documenti parti (venditore/acquirente) invariati, ma l'acquirente può ora essere `OPERATORE_AUTO` (visura, come AZIENDA).
- I `DocumentoRichiesto` per veicolo includono un riferimento all'ordine veicolo (per la UI: "Libretto veicolo 2").

---

## 5. actions.ts (creazione pratica)
- Schema submit: `tipo` ∈ {SEMPLICE, MINIVOLTURA}, `numeroVeicoli`, array `veicoli` (con libretto + dati), parti.
- Crea `Pratica` + n `Veicolo` + lega i `Documento` libretto a ciascun veicolo, in transazione.
- `computeFees({ tipo, numeroVeicoli })` per i fee.
- `flagMinivoltura = tipo === 'MINIVOLTURA'`.

## 6. Dettaglio pratica (`[id]/page.tsx`)
- `labelTipo()` → "Passaggio di proprietà semplice" / "Minivoltura" (+ "(multiplo, N veicoli)" se n>1).
- Mostrare la **lista veicoli** (targa/telaio per ciascuno) invece del singolo.

## 7. Seed
Aggiornare `seed.ts`: enum nuovi valori; per le pratiche di esempio creare i `Veicolo` collegati.

## 8. Edge / vincoli
- `numeroVeicoli` 1..50. Le varianti "singola" forzano 1.
- MINIVOLTURA singola ammessa (prima la minivoltura era solo multipla).
- Comodato d'uso attivo su un veicolo → blocco (come oggi, ora per-veicolo).
- Migrazione dati prod: ogni pratica esistente → 1 veicolo; verificare conteggi prima/dopo.

## 9. Testing
- `pricing.test.ts`: 4 casi + scaling per veicolo.
- `engine.test.ts`: documenti per-veicolo (1 e n veicoli, pre-2015 per-veicolo, comodato per-veicolo), acquirente OPERATORE_AUTO.
- Test data-migration (conteggio veicoli creati = conteggio pratiche; libretti collegati).
- E2E wizard (chrome-devtools) post-deploy: creazione minivoltura multipla con 2 libretti.

## 10. Fuori scope
- Modifiche al motore di distribuzione (resta tipo-agnostico).
- Pricing diverso dal lineare per-veicolo (confermato lineare).

## Sequenza
Modello+migration+pricing (puri/dati) → engine documenti per-veicolo → actions creazione → wizard (4 card + sezione veicoli ripetuta + acquirente operatore-auto) → dettaglio + seed → deploy + E2E.
