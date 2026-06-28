# Mandato fatturazione conto terzi — firma OTP al primo payout — Design

**Data:** 2026-06-28
**Branch:** main
**Stato:** approvato (design confermato dall'utente)

## Obiettivo

Alla **prima** richiesta di payout di un broker (o primo pagamento affiliazione di
un'agenzia — stesso flusso), mostrare una **modale obbligatoria** di presa visione
del contratto «Mandato per fatturazione per conto terzi e informativa privacy»,
**costruito dinamicamente** sui dati del firmatario, da **firmare via OTP**. Il
contratto firmato è salvato sull'azienda con data di accettazione ed è **visibile
dal pannello admin**.

Documento di riferimento (copiato nel repo):
`docs/contratti/mandato_fatturazione_conto_terzi_informativa_privacy.docx`.

## Decisioni di prodotto (confermate)

- **OTP via email**: codice monouso all'email dell'utente loggato (niente TOTP/SMS).
- **Una volta per azienda**: firmato una sola volta, vale per tutti i payout futuri
  (tutte le sedi). `MandatoFatturazione.companyId @unique`.
- **Firma solo l'ADMIN_AZIENDA** (rappresentante legale): il suo nome riempie «in
  persona di» del Mandante.

## Contesto esistente (verificato)

- **Payout** (broker e agenzia, stesso flusso): `app/wallet/payout-button.tsx` →
  `richiediPayoutAction()` in `app/wallet/actions.ts` crea un `Payout` (stato
  `RICHIESTO`) dal wallet della sede operativa. È il **punto unico di gate**.
  L'affiliazione non ha un flusso separato: le commissioni sono accreditate al
  wallet e l'agenzia le incassa con lo stesso `richiediPayoutAction`.
- **OTP esistente**: solo **TOTP app** (`lib/auth/totp.ts`, opt-in 2FA). **Nessun
  OTP via email** → da costruire (Resend è già presente; pattern email come
  `lib/auth/email-templates.ts` reset-password).
- **PDF**: `pdf-lib`, pattern `lib/fatturazione/pdf.ts` (`buildDocumentoPdf`,
  blocchi emittente/destinatario da `DatiFiscali`).
- **Dati parti**: `lib/fatturazione/pv-emittente.ts` → `pvEmittente(): DatiFiscali`
  (Passaggio Veloce, il **Mandatario**, da BRAND/env) e `snapshotCompany(c)` →
  `DatiFiscali` (il **Mandante**, dati del firmatario). `Company`:
  `ragioneSociale, partitaIva, codiceSdi, pec, indirizzo, civico, citta, cap,
  provincia`. `User`: `nome, cognome, codiceFiscale, role`.
- **Storage**: Vercel Blob (server put; chiave `{scope}/{uuid}-{file}`).
- **Admin**: `app/admin/companies/[id]/page.tsx` (`/admin/companies/{id}`) — oggi
  NON carica documenti; punto dove aggiungere la sezione mandato.

## Architettura

### A. Modello dati (nuovo) — `MandatoFatturazione`

```prisma
model MandatoFatturazione {
  id        String  @id @default(uuid()) @db.Uuid
  companyId String  @unique @db.Uuid          // una volta per azienda
  company   Company @relation(fields: [companyId], references: [id], onDelete: Cascade)

  firmatarioUserId String @db.Uuid            // l'ADMIN_AZIENDA che firma
  firmatario       User   @relation(fields: [firmatarioUserId], references: [id])
  firmatoAt        DateTime @default(now())   // data presa visione/accettazione

  // PDF firmato su Blob
  storageKey      String
  storageProvider String @default("local")
  mimeType        String @default("application/pdf")
  sizeBytes       Int

  // Snapshot immutabile dei dati usati nel contratto (audit legale)
  datiSnapshot Json     // { mandante: DatiFiscali, mandatario: DatiFiscali, firmatario: {nome,cognome,cf}, foro }

  // Audit firma OTP
  ip              String?
  userAgent       String?
  otpVerificatoAt DateTime

  createdAt DateTime @default(now())
  @@map("mandati_fatturazione")
}
```

La presenza della riga = "mandato firmato". Niente reuse di `Documento`/`DocumentoFiscale` (modello dedicato, self-contained per audit + admin).

### B. OTP via email (nuovo, minimo)

Campi su `User` (ephemeral, riusabili in futuro):
`mandatoOtpHash String?` (hash bcrypt del codice a 6 cifre) e
`mandatoOtpExpiresAt DateTime?` (scadenza ~10 min).

- `lib/contratti/otp.ts`: `generaCodiceOtp()` (6 cifre), `hashOtp`/`verifyOtp`
  (bcrypt), gestione scadenza/consumo (azzera i campi dopo verifica o invio nuovo).
- Email: nuovo template in `lib/auth/email-templates.ts` (es. `tplOtpMandato`) +
  invio diretto via `getEmail()` (NON `sendNotification`/enum NotificaTipo).
- `inviaOtpMandatoAction()`: genera codice, lo hasha+salva con scadenza su User,
  invia l'email. Best-effort rate-limit semplice (non re-inviare se l'ultimo è
  ancora valido da < 60s — opzionale, vedi YAGNI).

### C. Generazione PDF — `lib/contratti/mandato-pdf.ts`

`buildMandatoFatturazionePdf(input): Promise<Uint8Array>` con `pdf-lib`. Input:
```ts
type MandatoPdfInput = {
  mandante: DatiFiscali;
  mandanteRappresentante: string;       // "Nome Cognome"
  mandatario: DatiFiscali;              // pvEmittente()
  mandatarioRappresentante: string;     // env PV_RAPPRESENTANTE (default CEO)
  foro: string;                         // mandatario.citta
  firmatoAt: Date;
  otpAudit: { ip: string | null };
};
```
Rende **verbatim** le 10 clausole del contratto (titolo, parti, §1 Oggetto, §2
Attività autorizzate, §3 Obblighi Mandante, §4 Obblighi Mandatario, §5 Durata, §6
Responsabilità, §7 Trattamento dati GDPR, §8 Riservatezza, §9 Legge/Foro, §10
Sottoscrizione) con i blocchi Mandante/Mandatario compilati e un blocco firma:
«**Firmato elettronicamente via OTP** dal Mandante (Nome Cognome) il {firmatoAt},
codice verificato (IP {ip}).» + Mandatario pre-firmato (rappresentante PV). Il
testo legale è incorporato come costante nel modulo (fonte: il .docx in `docs/contratti`).

### D. Gate al primo payout

In `richiediPayoutAction` (`app/wallet/actions.ts`), **prima** di creare il
`Payout`: se l'azienda (`session.user.companyId`) non ha `MandatoFatturazione` →
ritorna `{ ok: false, requireMandato: true }` (segnale dedicato, non un errore).
Il tipo `PayoutResult` guadagna il campo opzionale `requireMandato?: true`.

### E. UI firma (modale) — `app/wallet/`

- `payout-button.tsx`: se `richiediPayoutAction` ritorna `requireMandato`, apre la
  modale `MandatoFirmaModal` invece di mostrare errore.
- `MandatoFirmaModal` (client): anteprima del contratto (testo dinamico
  renderizzato in HTML dai dati azienda) → «Invia codice via email»
  (`inviaOtpMandatoAction`) → input codice → «Firma» (`firmaMandatoAction(code)`).
  - **Solo ADMIN_AZIENDA**: se l'utente non è admin, la modale mostra «la firma
    spetta al titolare» e non procede.
- `firmaMandatoAction(code)`: verifica OTP (hash+scadenza) → costruisce
  `MandatoPdfInput` (snapshot company+PV+firmatario) → `buildMandatoFatturazionePdf`
  → put su Blob → crea `MandatoFatturazione` (snapshot+audit) → azzera l'OTP →
  `{ ok: true }`. Poi la UI invita a ripetere il payout (o lo ri-lancia).

### F. Pannello admin

- `app/admin/companies/[id]/page.tsx`: carica `mandatoFatturazione` (con
  `firmatario`) e mostra una sezione "Mandato fatturazione conto terzi": stato
  (firmato sì/no), firmatario, data, **download**.
- Route download admin-only: `GET /api/admin/mandato/[companyId]/pdf` → verifica
  ruolo admin → streamma il PDF dal Blob (storageKey).

## Edge cases

- **Azienda senza dati fiscali completi** (indirizzo/P.IVA): in registrazione sono
  obbligatori, quindi presenti. Se mancasse qualcosa, il PDF mostra i campi vuoti
  (non blocca); P.IVA è `@unique` non-null su Company.
- **OTP scaduto/errato**: messaggio chiaro, possibilità di re-inviare.
- **Doppia firma concorrente**: `companyId @unique` impedisce due righe; la seconda
  `create` fallisce → trattata come "già firmato" (idempotente: se esiste già, ok).
- **Payout dopo firma**: la firma sblocca i payout futuri; l'utente ripete la
  richiesta (la modale, alla chiusura post-firma, può ri-lanciare `richiediPayoutAction`).
- **Multi-sede**: il gate è a livello azienda (companyId), non sede.

## Test

- Unit `lib/contratti/mandato-pdf.ts`: l'output contiene ragione sociale/P.IVA
  Mandante e Mandatario, le intestazioni delle clausole, la nota di firma OTP.
- Unit `lib/contratti/otp.ts`: genera 6 cifre; verify ok con codice giusto entro
  scadenza; ko se scaduto o errato.
- Unit gate: `richiediPayoutAction` ritorna `requireMandato` se manca il mandato,
  procede se presente (mock prisma, pattern `sedi/actions.test.ts`).
- Verifica visiva manuale: modale primo payout (broker e agenzia), email OTP in
  console, sezione admin + download.

## File toccati (sintesi)

- `packages/db/prisma/schema.prisma` + migration — modello `MandatoFatturazione`,
  relazioni su Company/User, campi OTP su User.
- `docs/contratti/…docx` (riferimento, già copiato).
- `apps/piattaforma/src/lib/contratti/` (**nuovo**): `mandato-pdf.ts`, `otp.ts`,
  `testo.ts` (clausole verbatim) + test.
- `apps/piattaforma/src/lib/auth/email-templates.ts` — template OTP mandato.
- `apps/piattaforma/src/app/wallet/actions.ts` — gate + `inviaOtpMandatoAction` +
  `firmaMandatoAction`; `payout-button.tsx` + `MandatoFirmaModal` (nuovo).
- `apps/piattaforma/src/app/admin/companies/[id]/page.tsx` + sezione + route
  `app/api/admin/mandato/[companyId]/pdf/route.ts` (**nuovo**).

## Non in scope

- Firma del Mandatario "reale" (PV è pre-firmato col nome del rappresentante da env).
- Validazione avanzata IBAN/dati (già gestita altrove).
- Versionamento del contratto (una sola versione corrente; un eventuale aggiornamento
  testo è follow-up).
