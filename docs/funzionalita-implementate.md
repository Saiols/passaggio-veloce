---
chatbot_visibility: internal
---

# Passaggio Veloce — Funzionalità implementate (reality vs docs)

> **Scopo:** catalogo di ciò che il codice REALMENTE fa, comprese le feature
> implementate in sviluppo ma non (o solo parzialmente) previste nei documenti di
> pianificazione. Fonte: giro completo del codice 2026-06-10 (5 esplorazioni parallele).
> Default `internal`: contiene anche economia interna. Le voci marcate **[CLIENTI]** sono
> candidate a essere promosse nella `kb-clienti.md`; **[PUBBLICO]** in `kb-pubblico.md`.

---

## 0. ⚠️ Discrepanze codice ↔ documenti / decisioni (da risolvere)

| # | Tema | Codice | Decisione/Doc | Azione |
|---|---|---|---|---|
| 1 | ~~**Penale broker**~~ | **Risolto (2026-07-11)**: `lib/penali/config.ts` → `PENALE_BROKER_DEFAULT_CENT = 2_500` (**€25**) × numero di veicoli segnalati (`calcolaPenaleBrokerCent`), non più flat a pratica. Il compenso non è mai stornato nel caso normale (segnalazione pre-firma → il broker semplicemente non lo matura); lo storno resta un ramo difensivo per l'edge case di credito già accreditato. Vedi `sistema-penali-broker.md` e clausole 10.4/10.5 dei Termini. | — | — |
| 2 | **Payout reale** | `lib/providers/payment/stripe.ts`: payout "Strada B" è **no-op** (rifiuta se chiave live) | Spec: bonifico manuale conto PV | Da implementare prima del go-live payout. |
| 3 | **Fatturazione elettronica** | Modello `DocumentoFiscale` / `RegimeFiscale` **non presenti** nello schema Prisma | Spec `fatturazione-piattaforma.md` (FASE FT futura) | Non in MVP — fatturazione descritta ma non implementata. |
| 4 | **Canali notifiche** | Solo **EMAIL** (Resend). `SMS` e `IN_APP` sono enum definiti ma **non implementati** | Landing cita "notifiche multi-canale" | Allineare aspettative; SMS/in-app futuri. |
| 5 | **N5_BROKER_PAYOUT** | Enum presente ma **nessun sender** lo invia | — | Notifica payout non implementata. |
| 6 | **Codici promo CREDITO_PROMO** | Riscatto in registrazione presente; uso enum transazione `CREDITO_PROMO` non confermato in tutti i path | Memory: "in prod" | Verificare completezza accredito wallet. |
| — | **Copertura GDPR dati di terzi** | **Fatto (2026-07-14)**: PV **titolare autonomo** dei dati di venditore/acquirente (non responsabile ex art. 28 — determiniamo noi provider OCR, retention e antifrode). Termini: nuova **clausola 17** (garanzia + manleva, vessatoria; foro → 18, approvazione specifica → 19). Nuova informativa **art. 14** su `/privacy/clienti`, recapitata dalla mail **N40** che ora dice anche **da chi** abbiamo ricevuto i dati. `/privacy` corretta (Vercel Blob, non R2; permesso di soggiorno e certificato di morte dichiarati; retention veritiera). Il popup pre-invio raccoglie la garanzia a ogni pratica (`popupVersion` → `v3.0`). ⚠️ **DRAFT: da sottoporre a revisione legale prima del go-live.** Spec: `superpowers/specs/2026-07-14-gdpr-dati-terzi-design.md` | — | — |
| — | **Bug compilatore: spazi JSX mangiati nel testo legale** | **Risolto (2026-07-14)**, ma è una trappola strutturale per chiunque scriva testo legale in futuro: il compilatore SWC di Next.js **mangia lo spazio iniziale di un nodo di testo JSX che si estende su più righe**. `/termini` renderizzava **21 parole incollate** (`non è partedel contratto`, `tra 1 € e 200 €per pratica`, `respingerla(pratica`) in un contratto che gli utenti accettano in registrazione. Corretto con `{' '}` espliciti su 71 occorrenze in 4 pagine (`termini`, `privacy`, `privacy/clienti`, `cookie`); guardrail in `app/termini/spazi-jsx.test.ts`, che legge il sorgente (non il DOM) e fallisce sulla forma pericolosa (`</tag>` + spazio letterale + testo che va a capo). ⚠️ **Non far girare Prettier su quelle 4 pagine**: il reflow sposta gli a-capo e reintroduce il bug altrove (misurato: da 47 a 98 occorrenze a rischio nel solo `/termini`). | — | — |

---

## 1. Pratiche & documenti

- **[CLIENTI] Tipi pratica**: `SEMPLICE` (privato→privato) e `MINIVOLTURA` (operatore/commerciante). Singolo o multi-veicolo (`numeroVeicoli ≥ 1`). Modello `Veicolo` (n veicoli/pratica) + `Venditore` con `veicoloId` (venditori per-veicolo). Helper `intestatariPerVeicolo()`, `crossCheckPerVeicolo()` in `pratiche/nuova/venditori-per-veicolo.ts`.
- **[CLIENTI] Engine documenti** (`lib/documenti/engine.ts`, `calcolaDocumentiRichiesti()`): albero decisionale che determina la lista esatta di documenti da 8-9 variabili. Esiti: `OK` (lista) / `BLOCCO` (motivo+soluzione) / `INPUT_INCOMPLETO`. Pre-2015 → +Certificato di Proprietà. Comodato d'uso: rilevato dall'OCR e salvato come informazione, **non più ostativo** (non blocca la pratica). Procura/successione/minore → documenti extra.
- **[CLIENTI] Scanner documenti** (`components/document-scanner-modal.tsx`): ritaglio manuale immagini (angoli trascinabili), export JPEG; PDF passthrough. Upload **client-side su Vercel Blob** (il server riceve solo il riferimento).
- **[CLIENTI] OCR** (`lib/providers/ocr/**`): libretto (targa, telaio, anno, proprietari, comodato), CI/CF, visura, permesso. Provider mock/Mindee/Google Document AI. **OCR opzionale**: se fallisce, il form resta compilabile a mano (graceful).
- **Validazione parte OCR↔form** (`lib/kyc/parte-docs.ts`): MATCH/MISMATCH/ILLEGGIBILE/SCADUTO; nome via edit-distance, CF normalizzato, visura ≤6 mesi, permesso non scaduto.
- **Gating documenti** (`lib/documenti/gating-block.ts`): blocca submit se un file non passa regole (MIME, size, ecc.).
- **[CLIENTI] Revisione manuale**: "Non trovo la mia situazione" → pratica resta BOZZA, flag `richiedeRevisioneManuale`, team risponde in **24-48h**. Pagina admin `/admin/revisioni`. Notifiche N20/N21.
- **[CLIENTI] Stati pratica** (enum `PraticaStato`): `BOZZA`, `IN_ATTESA_ROUND_1/2/3`, `IN_ESCALATION`, `ACCETTATA`, `PROCESSATA`, `FIRMATA`, `SCADUTA`, `ANNULLATA`. 🚩 `PROCESSATA` (step intermedio agenzia-ha-completato, pre-firma) e `IN_ESCALATION` non erano nelle spec originali.
- **[CLIENTI] Distribuzione a raggio-km + pool cumulativo** (`lib/distribuzione/tick.ts` + `constants.ts`, **SHIPPED 2026-07-19**, vedi `superpowers/specs/2026-07-19-distribuzione-raggio-km-design.md`): selezione per **distanza reale (Haversine)** dalle coordinate del luogo di consegna scelto dal broker via autocomplete (`Pratica.lat/lng`), NON più per provincia. Round 1 = **500 m**, round 2 = **750 m**, round 3 = **1000 m** (`RAGGI_KM`), finestre **4h/4h/4h** lavorative ciascuna (`T1_HOURS/T2_HOURS/T3_HOURS`). **Tutte** le sedi idonee nell'anello ricevono l'assegnazione simultaneamente (nessun cap 5/15, nessuna selezione per ranking). **Pool cumulativo**: le sedi contattate nei round precedenti restano `PENDING` e accettabili — non vanno in TIMEOUT all'avanzamento; alla scadenza della finestra corrente si aprono le sedi nuove dell'anello e si ri-armano le `PENDING` scadute con finestra fresca. Anello vuoto → cascade immediato al raggio successivo; round 3 vuoto o scaduto senza accettazione → `IN_ESCALATION` (admin assegna a mano). Sedi senza coordinate escluse. **Prima agenzia che accetta vince.**
- **[CLIENTI] Countdown a ore lavorative** (`lib/distribuzione/countdown.ts` + `ore-lavorative.ts`): il countdown per agenzia conta **solo quando l'agenzia è aperta** (rispetta `OrariApertura` e salta `ChiusuraStraordinaria`). 🚩 Non documentato.
- **Ranking & anti-abuso**: `lib/distribuzione/ranking.ts` **rimosso** (2026-07-19) — il ranking **non seleziona più** i candidati (la selezione è solo a raggio-km, vedi sopra). Resta solo come **badge visivo admin** su `/admin/agenzie` (media valutazioni, "ranked" con ≥5 valutazioni, evidenzia rating basso <2.5) **senza alcun effetto operativo**: non sospende, non esclude dalla distribuzione. L'**auto-sospensione** (`lib/distribuzione/auto-suspend.ts`) resta ma è **solo timeout/no-show**: 5 `TIMEOUT` consecutivi sulla stessa sede → `Sede.suspendedAt` automatico (`ANTI_ABUSO.AUTO_SUSPEND_TIMEOUT_THRESHOLD`); nessun decay per rifiuti.
- **[CLIENTI] Inbox agenzia** (`/inbox`): accetta/rifiuta entro countdown; rifiuto → round successivo. Esiti assegnazione: PENDING/ACCETTATA/RIFIUTATA/TIMEOUT/ASSEGNATA_ALTRO.
- **[CLIENTI] Flusso firma**: ACCETTATA → (agenzia completa) PROCESSATA → (firma) FIRMATA.
- **Dichiarazione broker pre-invio** (`components/dichiarazione-popup.tsx`): checkbox obbligatorio "ho verificato fermo/ipoteca", loggato in `BrokerDichiarazione` (IP anonimizzato, userAgent, `POPUP_VERSION`).
- **Segnalazione + penale** (`lib/penali/segnalazione.ts`): agenzia segnala (fermo/ipoteca/doc non valido) in stati ACCETTATA/PROCESSATA → admin conferma (annulla + penale, **vedi discrepanza §0.1**) o respinge.
- **[CLIENTI] Valutazione agenzia**: post-firma il dealer valuta (1-5 stelle), unica per pratica, aggiorna la media visibile all'agenzia e all'admin (badge `/admin/agenzie`); **nessun effetto operativo** sulla distribuzione (vedi discrepanza ranking sopra).

---

## 2. Economico

- **[CLIENTI] Pricing** (`lib/pricing.ts`, per-veicolo × `numeroVeicoli`):
  - SEMPLICE e MINIVOLTURA: costo agenzia, compenso broker e costo affiliazione sono definiti dal **listino ufficiale corrente** (modificabile in `/admin/tariffe`); il ricavo lordo PV è derivato = costo − compenso.
- **[CLIENTI] Wallet broker**: saldo in cent, **può andare negativo** (penali). Banner di avviso in `/wallet` su saldo negativo; payout bloccato se negativo.
- **[CLIENTI] Payout**: manuale da **€500** (`MIN_PAYOUT_CENT`), automatico da **€1000** (soglia `Company.payoutThresholdCent`, configurabile **€1000–€5000**). 🚩 La spec affiliazione cita €500: verificare se la soglia auto è coerente.
- **Transazioni wallet** (`TransazioneWalletTipo`): CREDITO_PRATICA, PAYOUT_AUTOMATICO/MANUALE, RETTIFICA_ADMIN, STORNO, PENALE_BROKER, CREDITO_AFFILIAZIONE, CREDITO_PROMO.
- **[CLIENTI] Addebiti fee agenzia** (`FeeAddebito`): ADDEBITO_FIRMA o (futuro) AUTO_ADDEBITO_GIORNO_20. Dashboard `/addebiti` con upcoming + storico mensile; stati SCHEDULED→IN_LAVORAZIONE→SUCCESS/FAILED. Fee annullata se pratica ANNULLATA.
- **Stripe SEPA** (`lib/providers/payment/stripe-mandate.ts`): SetupIntent + mandato (PENDING→ACTIVE→FAILED); addebito off-session su mandato attivo. **Payout reale non implementato (§0.2).**
- **[CLIENTI] Affiliazione** (`lib/affiliazione/**`): link referral univoco (`Company.referralCode`), tracking click (`ReferralClick`, IP troncato). Commissioni al firma secondo il **listino ufficiale corrente** (se ci sono due referenti la quota è divisa a metà). Stato MATURATA→ACCREDITATA, oppure DA_REVISIONARE se anti-collusione **AF-AC** (SAME_IBAN/SAME_IP_SIGNUP) → review admin.
- **[CLIENTI] Codici promozionali**: riscatto in registrazione (step 4), accredito wallet best-effort post-commit.
- **Giustificativo interno costo promo ("Documento 2")** (`lib/fatturazione/giustificativo-promo.ts`, **SHIPPED 2026-07-19**, spec `superpowers/specs/2026-07-19-giustificativo-costo-promo-design.md`): al **payout che incassa credito `CREDITO_PROMO`**, si genera automaticamente un **giustificativo interno** (numerazione propria `GI-<anno>-NNNNN`, tabella `GiustificativoInterno`, best-effort e idempotente per `payoutId`) che documenta il bonus promozionale come **costo di marketing di PV ex art. 108 TUIR** — **non fiscale, non SdI**, non compare mai in `/fatturazione` del broker (`createDocBroker` continua a filtrare solo `CREDITO_PRATICA`/`CREDITO_AFFILIAZIONE`). Consultabile solo da admin in `/admin/costi-promozionali` (lista + filtro date + export CSV). Internal only.

---

## 3. Auth & onboarding

- **[CLIENTI] Registrazione wizard 4 step** (`(auth)/register/register-wizard.tsx`): Account → Azienda (P.IVA, **Codice SDI**, indirizzo con autocomplete) → **Documenti KYC** → Pagamento/T&C (IBAN, mandato SEPA per agenzia, promo, T&C). Percorsi distinti dealer/agenzia; preserva `?ref=` affiliazione.
- **[CLIENTI] Documenti registrazione**: CI fronte, CI retro, Codice Fiscale, **Visura camerale (≤6 mesi)**. Upload su Vercel Blob.
- **[CLIENTI] Gate KYC anticipato** (`(auth)/actions.ts` `verifyRegistrationDocumentsAction` + `lib/kyc/verify.ts`): allo step 3 fa OCR e valida **prima** di proseguire. Regole di blocco: `VISURA_SCADUTA` (>5-6 mesi), `ATECO_NON_IDONEO` (ATECO non in allowlist per tipo azienda), `AZIENDA_MISMATCH`, `CI_MISMATCH`, `CF_MISMATCH`, `ILLEGGIBILE`. Emette `kycToken` per evitare ri-OCR al submit. 🚩 Regole dettagliate non nei docs.
- **[CLIENTI] Verifica email**: link valido 24h → account `ACTIVE`. (In `DEMO_MODE` auto-attivo.)
- **Login multi-tenant** (`auth.ts`): **stessa email su N aziende** (`@@unique([companyId,email])`); prova password su tutti. Admin platform (`companyId=null`) unici globali.
- **[CLIENTI] 2FA** (`lib/auth/totp.ts`): TOTP (Google Authenticator/Authy/1Password) + **10 backup code** (mostrati una sola volta). Setup/disable in `/profilo/sicurezza`.
- **Rate limit login**: 5 tentativi falliti per (IP anonimizzato+email) → blocco 15 min.
- **[CLIENTI] Team**: ADMIN_AZIENDA invita UTENTE_AZIENDA (`/invito/{token}`, scadenza 7gg) o crea utente diretto (subito ACTIVE). Reset password genera password leggibile.
- **[CLIENTI] Profilo**: dati personali; dati azienda (solo ADMIN_AZIENDA; **P.IVA e SDI non modificabili** → supporto); sicurezza; ~~**listino prezzi (solo agenzia)**~~ _(⚠️ SOSPESA giu-2026: modulo disattivato e nascosto)_; preferenze notifiche.
- **[CLIENTI] Orari agenzia** (`/orari`): fino a 2 fasce/giorno; **influenzano il countdown** delle pratiche. Chiusure straordinarie.
- **Stato account**: `UserStatus` PENDING/ACTIVE/SUSPENDED; `Company.suspendedAt` (sospensione reversibile) ≠ `deletedAt` (eliminazione, dati cancellati ~90gg GDPR).

---

## 4. Comunicazioni & utente

- **[CLIENTI] Sistema notifiche** (`lib/notifiche/**`): solo canale **EMAIL via Resend** (SMS/IN_APP non implementati, §0.4). Audit in `NotificaInviata` (SCHEDULED/SENT/FAILED/READ/SKIPPED).
- **Tipi notifica (NotificaTipo) implementati** — trigger principali:
  - Broker: N1 invio pratica, N2 accettata, N3 sollecito (opz.), N4 firma+credito, N11 escalation, N13 pratica processata, N17 penale, N21 revisione completata, N31 valuta agenzia (opz.).
  - Agenzia: N6 nuova pratica, N7 promemoria countdown (opz.), N8 addebito, N18 segnalazione confermata.
  - Admin: N10 escalation, N19 nuova segnalazione, N20 revisione richiesta, N14/15/16 account sospeso/riattivato/eliminato.
  - Affiliazione: N12 commissione, N22 referral signup, N23 prima pratica referral, N24 payout affiliazione disponibile, N25 recap mensile.
  - 🚩 **N5_BROKER_PAYOUT definito ma non inviato** (§0.5).
- **[CLIENTI] Preferenze + unsubscribe** (`/profilo/notifiche`, `/unsubscribe`): transazionali sempre attive; **facoltative** (N3, N7, N25, N31) opt-out + unsubscribe one-click via token in footer email.
- **[CLIENTI] Storico notifiche** (`/notifiche`): ultime 50 con stato/canale/subject.
- **[CLIENTI] Dashboard**: broker (conteggi per stato, ultime 5 pratiche, saldo wallet, banner valuta-agenzia); agenzia (in arrivo/in corso/firmate mese, rating, prossimi addebiti). _(Banner "Pubblica il tuo listino" rimosso — feature SOSPESA giu-2026.)_
- **[PUBBLICO] Guide pubbliche** (`/guide`): "Come fare il passaggio di proprietà", "Costi passaggio di proprietà", "Documenti necessari". Pagine `/privacy`, `/termini`, `/cookie`.

---

## 5. Admin & CRM (staff interno)

- **Dashboard finanziaria** (`/admin/dashboard`): KPI pratiche, ricavo PV (fee−credito broker su FIRMATA), **"Già erogato vs Da erogare"** (monitoraggio liquidità anti-doppio-pagamento), top broker. 🚩 KPI liquidità non nei docs.
- **Gestione**: utenti, pratiche (priorità escalation in cima), **broker con badge ⚠️ penali** (alert ≥2), **segnalazioni** (conferma/respingi), **revisioni manuali**, **escalation** (assegnazione manuale con ranking stelle), assistenti, **affiliazioni** (funnel click→registrazione→pratica, sospette AF-AC), demo-control (solo DEMO_MODE).
- **CRM** (`/admin/crm/**`, ruoli AD/CTO/CFO/SALES_MANAGER/SALES):
  - **Contatti** pipeline lead S0–S10 (anagrafica, funnel, dati chiamate, tracking pixel, match piattaforma), import CSV, assegnazione sales (SALES vede solo i propri).
  - **Contatti operativi** (venditori/acquirenti deduplicati dalle pratiche).
  - **Sales** (`CrmSalesAgent` per Vapi: voce/accento/lingua/prompt/script/Q&A; `CrmCampaign` outbound con filtri, orari, max tentativi). Integrazione Vapi reale in CRM-H (account esterno).
  - **Chatbot** (`CrmChatbot`): config bot testuali — **è il modello su cui si innesta il chatbot LLM** (vedi `kb-*` e spec chatbot-llm).
  - **Permessi**: matrice read-only per ruolo.

---

## 6. Note per i bot FAQ

- Le voci **[CLIENTI]** sopra sono le più preziose per `kb-clienti.md` (operatività reale: round di distribuzione, countdown a ore lavorative, stati incl. PROCESSATA, revisione manuale, soglie payout, 2FA, notifiche, documenti registrazione).
- Le voci **[PUBBLICO]** (guide) possono arricchire `kb-pubblico.md`.
- Tutto il resto (economia interna, admin, CRM, anti-collusione, discrepanze §0) resta **internal**.
- **Da non promettere ai clienti finché non implementato**: SMS/notifiche in-app, payout reale automatico, fatturazione elettronica SDI, notifica payout (N5).
