# Pratica (B): co-intestatari — N venditori + cross-check insiemistico — Design

**Data:** 2026-06-06
**Stato:** approvato (design)
**Branch:** feat/tipi-pratica-multiveicolo (continua)
**Tappa B di 2** (A = identità/cross-check singolo, già fatta)

## Goal
Supportare i **co-intestatari**: dal libretto rilevare N proprietari e gestire N venditori (ciascuno con dati + documento d'identità + OCR), con cross-check **insiemistico** venditori↔proprietari del libretto (blocco se non coincidono). Acquirente resta singolo.

## Decisioni acquisite
1. **Modello `Venditore[]` uniforme** (come Veicolo): nuovo modello, rimozione campi venditore denormalizzati da `Pratica`. Acquirente resta singolo su Pratica.
2. **`Documento.venditoreId?`** per legare i documenti d'identità al venditore specifico.
3. **Cross-check rigoroso**: l'insieme dei venditori deve coincidere coi proprietari del libretto (ogni proprietario coperto, nessun venditore estraneo). Relax se `flagProcura`.
4. Rilevamento N proprietari **auto best-effort + correzione manuale**.

## 1. Modello dati (Prisma)
- **Nuovo modello `Venditore`**:
```prisma
model Venditore {
  id String @id @default(uuid()) @db.Uuid
  praticaId String @db.Uuid
  pratica Pratica @relation(fields:[praticaId],references:[id],onDelete:Cascade)
  ordine Int
  nome String?
  cognome String?
  cf String?
  isPersonaGiuridica Boolean @default(false)
  ragioneSociale String?
  piva String?
  telefono String?
  email String?
  tipoSoggetto TipoSoggetto?
  visuraData DateTime? @db.Date
  permessoData DateTime? @db.Date
  documentoIdentita String?  // 'CI' | 'PASSAPORTO' | 'PATENTE'
  documenti Documento[] @relation("DocumentiVenditore")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([praticaId])
  @@map("venditori")
}
```
- **`Pratica`**: RIMUOVI i campi `venditoreNome/cognome/CF/IsPersonaGiuridica/RagioneSociale/PIVA/Telefono/Email/TipoSoggetto/VisuraData/PermessoData/DocumentoIdentita`. Aggiungi `venditori Venditore[]`. (L'acquirente* resta invariato su Pratica.)
- **`Documento`**: aggiungi `venditoreId String? @db.Uuid` + relazione `venditore Venditore? @relation("DocumentiVenditore", onDelete:SetNull)` + `@@index([venditoreId])`.
- **Migration** (prod manuale, col blocco): create `venditori`; backfill 1 venditore/pratica dai campi denormalizzati (ordine 1); add `documenti.venditoreId`; collega i `Documento` con `owner='VENDITORE'` al venditore della pratica; DROP delle colonne venditore da `pratiche`.

## 2. Libretto multi-proprietario
`lib/providers/ocr/libretto-parser.ts`: aggiungi `proprietari: string[]` a `LibrettoCircolazioneData` (tutti gli intestatari rilevati). Mantieni `proprietarioAttuale = proprietari[0]` per retro-compat. Calibrazione su libretti reali (più blocchi C / "COINTESTATARIO").

## 3. Engine — documenti per-venditore
`lib/documenti/engine.ts`: l'input passa da campi venditore singoli a `venditori: { ordine, tipoSoggetto, documentoIdentita, visuraData, permessoData }[]`. Per ciascun venditore emetti i suoi documenti (identità/visura) taggati con `venditoreOrdine` su `DocumentoRichiesto`. I blocchi (visura fresca, permesso stranieri) si applicano per venditore. L'acquirente resta singolo. Aggiungi `venditoreOrdine?: number` a `DocumentoRichiesto`.

## 4. richiesti.ts — docKey con venditoreOrdine
`docKey` diventa `${tipo}__${parte}__${veicoloOrdine ?? 0}__${venditoreOrdine ?? 0}` (così le card non-identità per-venditore — es. VISURA_CAMERALE di un venditore azienda — hanno chiavi distinte). `requiredUploadDocs` invariato (esclude identità). `docLabel` per i doc venditore include "Venditore N" quando `venditoreOrdine` presente.

## 5. Cross-check insiemistico
`lib/kyc/match.ts`: `venditoriCrossCheck(venditori, proprietari, opts:{flagProcura})` → `'OK' | { kind:'MISMATCH'; dettaglio }`:
- Costruisci la lista identificativi venditori (nome+cognome o ragione sociale) e proprietari.
- Ogni proprietario deve avere un venditore corrispondente (`nameMatches`/company) **e** ogni venditore deve corrispondere a un proprietario (no estranei). Conteggi devono combaciare.
- Se `flagProcura` → rilassa (basta ≥1 venditore corrispondente; gli altri proprietari coperti da procura). 
- Proprietari non estratti (`[]`) → SCONOSCIUTO (no blocco).
Riusa `proprietarioCrossCheck`/`nameMatches`.

## 6. Wizard (step Venditore)
- Stato `venditori: VenditoreInput[]` (ciascuno: dati parte + `documentoIdentita` + file identità + permesso). Auto-popolato dai `proprietari` del primo veicolo (un form per proprietario), con add/remove e correzione.
- Per ogni venditore: `ParteForm` + sezione identità (riusa A) + OCR pre-fill + permesso.
- Cross-check insiemistico mostrato in cima allo step; blocco `canStepVenditore` su MISMATCH (salvo procura).
- Acquirente step invariato.

## 7. Action
Persiste N `Venditore` + i loro `Documento` identità (venditoreId/ordine). Ricalcola engine con `venditori[]`. Riapplica `venditoriCrossCheck` server-side (blocco). Gli slot file identità diventano per-venditore: `VEND<ordine>_ID_FRONTE`/`_RETRO`/`VEND<ordine>_ID`/`VEND<ordine>_PERMESSO`.

## 8. Consumer ripple (~15-20 file)
I file che leggono `pratica.venditoreNome/…` (inbox, admin pratiche/escalation/revisioni/segnalazioni, dashboard broker/agenzia, export, PDF rendiconto, zip naming, ecc.) → leggere da `pratica.venditori[0]` (primario) con "+N" se più d'uno. Le query Prisma includono `venditori`. Stesso pattern usato per Veicolo.

## Edge / vincoli
- Cross-check riferito ai proprietari del **primo veicolo** (in multi-veicolo, gli altri non vincolano i venditori; assunzione: i veicoli di una pratica hanno gli stessi intestatari). Documentare.
- Procura: rilassa il vincolo insiemistico.
- Calibrazione OCR multi-owner su libretti reali.

## Testing
- `libretto-parser` multi-owner (unit).
- `venditoriCrossCheck` (unit: match completo, proprietario mancante, venditore estraneo, procura, sconosciuto).
- engine per-venditore (unit).
- richiesti docKey con venditoreOrdine (unit).
- migration backfill (conteggio venditori == pratiche).
- E2E: libretto cointestato → N form; mismatch → blocco.

## Migration (col deploy in blocco)
`venditori` + `documenti.venditoreId` + backfill + drop colonne venditore. Insieme alle altre migration del branch.

## Sequenza
modello+migration → libretto multi-owner → engine per-venditore → richiesti docKey → cross-check insiemistico → wizard N venditori → action → consumer ripple → verifica.
