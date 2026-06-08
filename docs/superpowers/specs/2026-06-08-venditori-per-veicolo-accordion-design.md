# Venditori per-veicolo + accordion (passaggi multipli) — Design

**Data:** 2026-06-08
**Stato:** approvato (design)
**Branch:** main

## Goal
Nei passaggi **multipli** i venditori (intestatari) devono essere organizzati **per veicolo**: ogni veicolo ha i propri venditori (gli intestatari del suo libretto, C.2 + C.3), ciascuno con i propri documenti. La UI raggruppa con un **accordion** (una voce per veicolo) e offre "Aggiungi co-intestatario" **per veicolo**. Il legame venditore↔veicolo è persistito nel DB.

## Decisioni acquisite
1. **Legame venditore↔veicolo nel DB**: `Venditore.veicoloId` (migration additiva, nullable).
2. **Stesso intestatario su più veicoli → ripetuto per veicolo** (no dedup; documenti per veicolo).
3. **Accordion solo per i passaggi multipli**; il singolo resta col layout attuale.

## 1. Modello dati (Prisma)
- `Venditore` → aggiungere `veicoloId String? @db.Uuid` + relazione `veicolo Veicolo? @relation(fields:[veicoloId], references:[id], onDelete:SetNull)` + `@@index([veicoloId])`. Lato `Veicolo`: `venditori Venditore[]`.
- **Migration** additiva: `ALTER TABLE "venditori" ADD COLUMN "veicoloId" UUID;` + FK (ON DELETE SET NULL) + index. Nessun backfill (i venditori esistenti restano `veicoloId = null`). Niente DROP. Da applicare a prod in blocco col deploy.

## 2. Stato wizard (`pratiche/nuova/wizard.tsx`)
- `VenditoreInput` acquisisce `veicoloOrdine: number` (1..n, il veicolo a cui appartiene).
- **Rigenerazione automatica per-veicolo, senza dedup**: l'effect che oggi costruisce `venditori` dall'unione dedup degli intestatari diventa: per ogni veicolo con OCR, un `VenditoreInput` per ciascun `proprietariInfo` del SUO libretto, taggato `veicoloOrdine`. Firma di rigenerazione include il `veicoloOrdine` (→ stesso intestatario su 2 veicoli = 2 voci). Si rigenera solo quando l'insieme (per veicolo) cambia, per non sovrascrivere le modifiche manuali.
- `ordine` venditore resta **globale 1..n** (indice nell'array `venditori`), usato per gli slot file `VEND<ordine>_*`. `veicoloOrdine` è il raggruppamento.
- Add/remove co-intestatario: `addVenditore(veicoloOrdine)` aggiunge un venditore vuoto a quel veicolo; `removeVenditore(idx)` invariato. Gli `ordine` (indici) si ricalcolano sull'array.

## 3. UI step Venditore
- **Multiplo** → nuovo componente accordion (es. `VeicoloVenditoriAccordion` o inline): una voce per veicolo con header `Veicolo N — TARGA` (e stato sintetico, es. n. venditori / problemi). Aperta mostra, per ogni venditore di quel veicolo: `ParteForm` + `IdentitaSection` (identità/visura/permesso) + alert verdetto documentale; in fondo "**+ Aggiungi co-intestatario**" (per quel veicolo) + l'alert **cross-check del veicolo**.
- **Singolo** → layout attuale invariato (venditori diretti, niente accordion).
- Default accordion: prima voce aperta (le altre chiuse); l'utente apre/chiude.
- Riuso dei componenti esistenti `ParteForm`/`IdentitaSection`/`UploadCard`.

## 4. Cross-check PER-VEICOLO
- `lib/kyc/match` `venditoriCrossCheck` invariato (riceve già un sottoinsieme). Si applica **per veicolo**: per ogni veicolo *i*, `venditoriCrossCheck(venditoriDelVeicolo_i, proprietariLibretto_i, {flagProcura:false})`. Blocco (`canStep2`) se un qualsiasi veicolo è MISMATCH; OK/SCONOSCIUTO proseguono. L'alert si mostra nell'accordion del veicolo interessato.
- **Server** (`submitNuovaPraticaAction`): stessa logica per-veicolo (autoritativa). Sostituisce l'attuale cross-check sull'unione globale.

## 5. Submit (`pratiche/nuova/actions.ts`)
- `venditoreSchema` → aggiungere `veicoloOrdine: z.coerce.number().int().min(1).max(50)`.
- `handleFinalSubmit` (wizard) → includere `veicoloOrdine` nel JSON `venditori`. Slot identità `VEND<ordine>_*` invariati.
- Transazione: creare ogni `Venditore` con `veicoloId = veicoloIdByOrdine.get(v.veicoloOrdine)` (la mappa esiste già per i veicoli). Identità docs già linkate via `venditoreId`.
- Cross-check per-veicolo come §4.

## 6. Invariati / fuori scope
- `engine` documentale e `parte-docs` (verifica documentale per-venditore via `ordine`): invariati.
- Acquirente: singolo, invariato.
- Consumer (inbox/[id], pratiche/[id], catalogo-contatti): continuano a leggere `venditori[]` (e `venditori[0]` come primario). Il raggruppamento per-veicolo nei pannelli admin è **fuori scope v1** (il dato `veicoloId` è comunque persistito per uso futuro).

## Edge / vincoli
- Veicolo senza intestatari OCR: nessun venditore auto-generato → l'utente usa "Aggiungi co-intestatario" per quel veicolo (gate cross-check = SCONOSCIUTO, non blocca, ma servono comunque i documenti).
- `ordine` globale univoco (refine già presente lato server).
- Migration additiva (no DROP) → backward-compatible col codice live precedente.

## Testing
- Unit: rigenerazione per-veicolo (un venditore per intestatario per veicolo, `veicoloOrdine` corretto; stesso intestatario su 2 veicoli = 2 voci) — funzione pura estraibile.
- Unit: cross-check per-veicolo (un veicolo MISMATCH blocca, gli altri OK).
- `venditoreSchema` con `veicoloOrdine` (zod).
- E2E manuale: passaggio multiplo 2 veicoli con intestatari diversi → 2 voci accordion, ognuna coi suoi venditori/documenti; co-intestato (C.2+C.3) sotto un veicolo → 2 venditori; "aggiungi co-intestatario"; submit → `Venditore.veicoloId` valorizzato.

## Sequenza implementazione
1. Migration `Venditore.veicoloId` + schema Prisma + `db:generate`.
2. Wizard: stato `veicoloOrdine` + rigenerazione per-veicolo + add/remove per veicolo.
3. UI accordion (multiplo) + singolo invariato.
4. Cross-check per-veicolo (wizard + server).
5. Submit: schema `veicoloOrdine` + persistenza `veicoloId`.
6. Test + gate + deploy in blocco (con migration su prod `solitary-night`).
