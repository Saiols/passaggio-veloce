# Codici promozionali — Design

**Data:** 2026-06-04
**Stato:** approvato (brainstorming)
**Contesto:** richiesto da Francesco (walkthrough). Admin crea codici testuali con importo e scadenza opzionale; in registrazione l'utente inserisce un codice e, se valido, l'importo viene accreditato sul wallet della nuova azienda. Vedi [[project-codici-promozionali]].

## Obiettivo
Sistema di codici promozionali: CRUD admin + riscatto in fase di registrazione con accredito automatico sul wallet, **non bloccante** (codice opzionale; se invalido la registrazione procede senza bonus).

## Modello dati (Prisma + migration su prod `solitary-night`)

```prisma
model PromoCode {
  id             String   @id @default(uuid()) @db.Uuid
  code           String   @unique            // salvato UPPERCASE + trim
  amountCent     Int                         // bonus accreditato sul wallet
  expiresAt      DateTime?                    // null = nessuna scadenza
  maxRedemptions Int?                         // null = illimitato
  active         Boolean  @default(true)      // disattivabile da admin
  createdById    String?  @db.Uuid           // admin che l'ha creato (audit)
  redemptions    PromoCodeRedemption[]
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@map("promo_codes")
}

model PromoCodeRedemption {
  id                  String   @id @default(uuid()) @db.Uuid
  promoCodeId         String   @db.Uuid
  promoCode           PromoCode @relation(fields: [promoCodeId], references: [id], onDelete: Cascade)
  companyId           String   @db.Uuid
  company             Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  amountCent          Int                       // importo accreditato (snapshot)
  transazioneWalletId String?  @db.Uuid         // transazione di accredito (audit)
  createdAt           DateTime @default(now())
  @@unique([promoCodeId, companyId])            // 1 riscatto per azienda
  @@index([promoCodeId])
  @@map("promo_code_redemptions")
}
```
- Nuovo valore enum **`TransazioneWalletTipo.CREDITO_PROMO`** (migration: `ALTER TYPE ... ADD VALUE`).
- `Company` ottiene la relazione inversa `promoRedemptions PromoCodeRedemption[]` (e `PromoCode`/`PromoCodeRedemption` registrati nello schema).
- Conteggio riscatti = `count(PromoCodeRedemption WHERE promoCodeId)`. "Esaurito" se `maxRedemptions != null && count >= maxRedemptions`.

## Logica di validazione (pura, testabile)
`evaluatePromoCode(promo, redemptionsCount, now) → Stato`:
- `null/undefined` (non trovato) **oppure** `!active` → `inesistente`
- `expiresAt && expiresAt < now` → `scaduto`
- `maxRedemptions != null && redemptionsCount >= maxRedemptions` → `esaurito`
- altrimenti → `{ stato: 'valido', amountCent }`

Tipo risultato: `{ stato: 'inesistente' } | { stato: 'scaduto' } | { stato: 'esaurito' } | { stato: 'valido'; amountCent: number }`.

## Sezione admin — `/admin/codici-promozionali`
- **Crea**: codice (testo), importo (€ → cent), scadenza (opzionale), max riscatti (opzionale). Salva UPPERCASE+trim; errore se codice duplicato.
- **Lista**: tabella con codice, importo, scadenza, riscatti usati / max, stato derivato (attivo / scaduto / esaurito / disattivato).
- **Disattiva/riattiva**: toggle `active` (server action).
- Accesso: solo `ADMIN_PIATTAFORMA` (come le altre sezioni `/admin/*`).
- Fuori scope ora: edit importo/scadenza, cancellazione (estensione futura).

## Registrazione (step 4 Pagamento)
- Campo **"Codice promozionale (opzionale)"** + bottone **"Applica"** → server action `checkPromoCodeAction(code)` → ritorna lo Stato; UI mostra:
  - `inesistente` → "Codice inesistente"
  - `scaduto` → "Codice scaduto"
  - `esaurito` → "Codice non più disponibile"
  - `valido` → "Codice valido: {X} € verranno accreditati sul tuo wallet" ✅
- Il codice (trim/upper) viaggia nel payload del wizard verso `registerAction`.
- **`registerAction`** (best-effort, NON bloccante): se è presente un codice, dentro la transazione di registrazione, dopo la creazione azienda:
  1. carica il PromoCode (lock/`count` riscatti), valuta con `evaluatePromoCode`.
  2. se `valido`: crea/recupera il **Wallet** dell'azienda → `TransazioneWallet` (`CREDITO_PROMO`, `importoCent`, `saldoPostCent`) → aggiorna `saldoCent` → crea `PromoCodeRedemption` (con `transazioneWalletId`). Esito promo = applicata.
  3. se non valido: **nessun accredito**, la registrazione **procede comunque**. Esito promo = non applicata (con motivo).
- `registerAction` ritorna l'esito: `{ ok: true, emailVerificationToken, promo?: { applied: true, amountCent } | { applied: false } }`.
- **Schermata finale** del wizard mostra:
  - applicata → "Promozione applicata: {X} € accreditati sul tuo wallet."
  - codice fornito ma non valido → "Codice promozionale non valido: nessuna promozione attivata."
  - nessun codice → niente.

## Note tecniche
- Wallet: la registrazione non crea il Wallet → in fase di accredito si crea/recupera (upsert per `companyId`).
- Concorrenza `maxRedemptions`: check sul conteggio dentro la transazione; sotto altissima concorrenza è teoricamente possibile 1 riscatto oltre il massimo (accettabile per promo). L'unique `[promoCodeId, companyId]` garantisce comunque max 1 per azienda.
- Normalizzazione codice: UPPERCASE + trim ovunque (creazione, check, submit).

## Testing
- Unit puri `evaluatePromoCode`: inesistente/non-attivo/scaduto/esaurito/valido (+ boundary scadenza, maxRedemptions).
- `checkPromoCodeAction` (mock prisma): mappa lo stato corretto.
- `registerAction` (estende test esistente): con codice valido → accredita wallet + redemption + ritorna `promo.applied=true`; con codice invalido → nessun accredito, registrazione ok, `promo.applied=false`; senza codice → invariato.
- Admin: test creazione (UPPERCASE+trim, duplicato) e toggle.

## Deploy
- Migration additiva (`promo_codes`, `promo_code_redemptions`, enum `CREDITO_PROMO`) → applicare a prod `solitary-night` PRIMA del codice. Vedi [[project-prod-release-process]].
