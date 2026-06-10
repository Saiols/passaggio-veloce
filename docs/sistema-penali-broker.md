# Passaggio Veloce — Sistema Penali Broker

> Sorgente: `docs/PassaggioVeloce SistemaPenaliBroker.docx` (aprile 2025).
> Owner: CTO Francesco Sioli. Decisioni post-allineamento 2026-05-05.
> Source-of-truth della feature.
>
> **Allineamento 2026-06-10:** importo e modello economico allineati a
> `segnalazioni-penali.md` (fonte `SegnalazioniPenali.docx`, riferimento confermato):
> **penale €25** + storno del compenso €25 maturato dal broker = **−€50 totali** per il
> broker; PV trattiene €25. Sostituisce il precedente €100.

---

## Logica di base

PV non effettua visure PRA automatiche. La verifica del veicolo (fermi, ipoteche, vincoli) è **interamente del broker**. Il sistema funziona su 3 livelli:

1. **Dichiarazione broker** — popup obbligatorio pre-invio con valore contrattuale
2. **Verifica agenzia** — se in fase di lavorazione rileva fermo/ipoteca, segnala
3. **Intervento PV** — admin annulla la pratica, addebita penale, rimborsa fee agenzia

Zero costi operativi PV, zero API PRA, zero attriti d'integrazione.

---

## Decisioni prese (2026-05-05)

| # | Tema | Decisione |
|---|---|---|
| 1 | Visura PRA | PV NON la fa, broker dichiara via popup. Lo Schema Documentale "Visura PRA automatica" è obsoleto e va riallineato. |
| 2 | Stato pratica durante segnalazione | **Flag** `flagSegnalata: bool` + `tipoSegnalazione`/`notaSegnalazione`. Lo stato `PraticaStato` resta quello attuale. |
| 3 | Penale | Transazione wallet separata `TransazioneWalletTipo.PENALE_BROKER`, importo configurabile. |
| 4 | Wallet negativo | `Wallet.saldoCent` accetta valori negativi. Blocca solo payout, non upload pratiche. |
| 5 | Finestra segnalazione | Solo pre-firma: stati `ACCETTATA` o `PROCESSATA`. Dopo `FIRMATA` la pratica è chiusa, eventuali contestazioni fuori-piattaforma. |
| 6 | Soglia alert sospensione | Costante `MAX_PENALI_BEFORE_ALERT = 2`. Configurabile in fase futura. |
| 7 | Importo penale | Costante runtime `PENALE_BROKER_DEFAULT_CENT = 2500` (€25), configurabile via env o Settings admin (FASE futura). Oltre alla penale, l'azione storna il compenso €25 della pratica → impatto broker **−€50**. |

---

## Schema impacts

```prisma
// Nuovo tipo transazione wallet
enum TransazioneWalletTipo {
  CREDITO_PRATICA
  PAYOUT_AUTOMATICO
  PAYOUT_MANUALE
  RETTIFICA_ADMIN
  STORNO
  CREDITO_AFFILIAZIONE
  PENALE_BROKER          // NEW: addebito penale per segnalazione confermata
}

// Nuovo enum tipo segnalazione
enum SegnalazionePraticaTipo {
  FERMO_AMMINISTRATIVO
  IPOTECA
  DOCUMENTO_NON_VALIDO
  ALTRO
}

// Nuovo enum stato segnalazione
enum SegnalazionePraticaStato {
  RICEVUTA              // Segnalazione inserita dall'agenzia
  CONFERMATA            // Admin verifica e conferma annullo + penale
  RESPINTA              // Admin verifica e respinge (pratica torna live)
}

model Pratica {
  // ... campi esistenti
  flagSegnalata          Boolean                  @default(false)
  tipoSegnalazione       SegnalazionePraticaTipo?
  notaSegnalazione       String?
  segnalataAt            DateTime?
  segnalataDaUserId      String?                  @db.Uuid
  segnalazioneEsitaAt    DateTime?
  segnalazioneEsitaDaId  String?                  @db.Uuid
  segnalazioneStato      SegnalazionePraticaStato?
  // Penale eventualmente addebitata su questa pratica (per audit)
  penaleAddebitatoCent   Int?
}

// Nuove notifiche
enum NotificaTipo {
  // ... esistenti
  N17_BROKER_PENALE_ADDEBITATA       // NEW
  N18_AGENZIA_SEGNALAZIONE_CONFERMATA // NEW
  N19_ADMIN_NUOVA_SEGNALAZIONE        // NEW
}
```

**Wallet negativo:** Prisma non vincola `Int >= 0`, quindi nessun cambio schema. Aggiunto solo invariante applicativo: payout solo se `saldoCent >= MIN_PAYOUT_CENT` (già presente).

Migrazioni stimate: 3
- `add_segnalazione_pratica` — campi su Pratica + 2 enum
- `add_penale_broker_tx_type` — enum value
- `add_lifecycle_segnalazione_notif` — 3 nuovi NotificaTipo

---

## Componenti & flussi

### 1. Popup di responsabilità broker (pre-invio)

**Quando:** ultimo step del wizard `/pratiche/nuova`, prima del submit finale.

**Markup:**
```
⚠️ VERIFICA OBBLIGATORIA PRIMA DI INVIARE

Prima di inviare questa pratica, conferma di aver verificato personalmente che:
• Il veicolo NON ha fermi amministrativi attivi
• Il veicolo NON ha ipoteche o vincoli iscritti al PRA
• Tutti i documenti caricati sono autentici e corrispondenti al veicolo

Puoi verificare lo stato del veicolo con una visura PRA su:
sportello.aci.it (apre nuova tab)

In caso di pratica inviata con veicolo soggetto a fermo o ipoteca, la pratica
verrà annullata: perderai il compenso di €25,00 maturato e ti verrà addebitata una
penale di €25,00 lordi dal wallet (impatto totale −€50,00).

[ ] Confermo di aver verificato quanto sopra e mi assumo piena responsabilità

[Conferma e invia]   ← disabled finché checkbox non spuntato
```

**Log accettazione (modello nuovo `BrokerDichiarazione`):**
```prisma
model BrokerDichiarazione {
  id             String   @id @default(uuid()) @db.Uuid
  praticaId      String   @db.Uuid
  pratica        Pratica  @relation(fields: [praticaId], references: [id])
  userId         String   @db.Uuid
  user           User     @relation(fields: [userId], references: [id])
  ip             String?
  userAgent      String?
  popupVersion   String   // es. "v1.0" — per audit se cambia testo
  createdAt      DateTime @default(now())
  @@index([praticaId])
  @@index([userId])
  @@map("broker_dichiarazioni")
}
```

IP anonimizzato GDPR (es. `192.168.1.x`).

**Acceptance:**
- Bottone "Conferma e invia" visivamente disabled finché checkbox non spuntato
- Click "Conferma e invia" → server action accetta solo se nello stesso form `dichiarazioneAccettata=true`
- Log creato in transazione con la `Pratica.create()`/submit

### 2. Bottone "Segnala problema" (lato agenzia)

**Quando:** sempre visibile sulla scheda pratica `/pratiche/[id]` per l'agenzia assegnata, in stati `ACCETTATA` o `PROCESSATA`. Non visibile a `FIRMATA` o successivi.

**Form:**
- Select tipo problema (`SegnalazionePraticaTipo`)
- Textarea nota (max 500 char, opzionale)
- Bottone "Invia segnalazione" con conferma

**Server action `segnalaPraticaAction`:**
- Guard: solo agenzia assegnata, stato in `[ACCETTATA, PROCESSATA]`, `flagSegnalata=false`
- Aggiorna pratica: `flagSegnalata=true`, `tipoSegnalazione`, `notaSegnalazione`, `segnalataAt`, `segnalataDaUserId`, `segnalazioneStato='RICEVUTA'`
- Notifica `N19_ADMIN_NUOVA_SEGNALAZIONE` a tutti gli admin platform

**Acceptance:**
- Agenzia clicca, conferma, vede toast "Segnalazione inviata al team"
- Pratica nella lista mostra badge "Segnalata"
- Admin riceve email entro pochi secondi

### 3. Workflow admin: verifica + annullamento + penale

**Pagina:** `/admin/segnalazioni` — riservata a `ADMIN_PIATTAFORMA`.

**UI:** lista delle pratiche con `flagSegnalata=true` e `segnalazioneStato='RICEVUTA'`, con:
- Codice pratica, broker, agenzia, tipo segnalazione, nota
- Bottoni "Conferma annullo + addebita penale" / "Respingi segnalazione"

**Server action `confermaAnnullamentoConPenaleAction(praticaId)`:**
1. Guard admin platform
2. Transazione:
   - `Pratica.update`: `stato='ANNULLATA'`, `annullataAt=now`, `segnalazioneStato='CONFERMATA'`, `segnalazioneEsitaAt=now`, `segnalazioneEsitaDaId=adminId`, `penaleAddebitatoCent=PENALE_BROKER_DEFAULT_CENT`
   - Storno compenso pratica: se il broker aveva maturato il credito €25 (`CREDITO_PRATICA`) su questa pratica → `TransazioneWallet.create` `tipo='STORNO'`, `importoCent=-2500`
   - `Wallet.upsert` broker, penale: `saldoCent -= 2500` (può andare negativo)
   - `TransazioneWallet.create`: `tipo='PENALE_BROKER'`, `importoCent=-2500`, `saldoPostCent=newBalance`, `praticaId`
   - Se esiste `FeeAddebito` schedulato per agenzia su questa pratica → `stato='ANNULLATO'`, no addebito (rimborso preventivo)
3. Post-commit best-effort:
   - `N17_BROKER_PENALE_ADDEBITATA` al broker
   - `N18_AGENZIA_SEGNALAZIONE_CONFERMATA` all'agenzia

**Server action `respingiSegnalazioneAction(praticaId, motivo)`:**
- Guard admin platform
- `Pratica.update`: `flagSegnalata=false`, `segnalazioneStato='RESPINTA'`, `segnalazioneEsitaAt=now`, `segnalazioneEsitaDaId=adminId`
- Pratica torna utilizzabile, agenzia può continuare lavorazione
- Notifica all'agenzia con motivo del respingimento

### 4. Wallet negativo

- `Wallet.saldoCent` può scendere sotto zero
- Bottone "Richiedi payout" su `/wallet`: già disabled se `< MIN_PAYOUT_CENT`. Aggiungere copy esplicito quando saldo è negativo: "Saldo negativo: reintegra prima di richiedere payout"
- Auto-payout cron skippa wallet con saldo < soglia
- Caricamento nuove pratiche: nessun blocco
- Banner UI in `/wallet` quando `saldoCent < 0`: alert giallo "Saldo wallet negativo. Reintegra al più presto per sbloccare il payout."

### 5. Alert sospensione (≥2 penali)

**Constant:** `MAX_PENALI_BEFORE_ALERT = 2` in `lib/penali/config.ts`.

**Implementazione:** quando si conferma una penale, post-commit query:
```sql
SELECT COUNT(*) FROM transazioni_wallet
WHERE walletId = ? AND tipo = 'PENALE_BROKER'
```
Se `>= 2` → notifica admin (via `N19` ridotto, o riusiamo email diretta agli admin platform).

**UI admin:** `/admin/broker` mostra badge "⚠️ N penali" sulle company con count >= 1, rosso da 2 in su.

---

## Pagine e route nuove

| Path | Ruolo | Scopo |
|---|---|---|
| `/admin/segnalazioni` | ADMIN_PIATTAFORMA | Lista segnalazioni RICEVUTE + azioni |
| Modale popup pre-invio | DEALER | Dichiarazione obbligatoria con log |
| Bottone "Segnala problema" | AGENZIA | In `/pratiche/[id]` per stati ACCETTATA/PROCESSATA |

Aggiunta voce sidebar admin: `Segnalazioni` (con badge count se > 0).

---

## Notifiche (templates)

### N17_BROKER_PENALE_ADDEBITATA
- **Subject:** `⚠️ Penale di €25 addebitata — pratica {codicePratica}`
- **Body:** "La pratica X è stata annullata in seguito a segnalazione di {tipo}. Hai perso il compenso di €25 e ti sono stati addebitati €25 di penale (impatto totale −€50). Saldo attuale: {saldo}. Se il saldo è negativo dovrai reintegrarlo prima di poter ricevere payout."

### N18_AGENZIA_SEGNALAZIONE_CONFERMATA
- **Subject:** `Segnalazione confermata — pratica {codicePratica} annullata`
- **Body:** "La tua segnalazione di {tipo} sulla pratica X è stata confermata dal team. La pratica è annullata e nessun fee ti verrà addebitato. Grazie per la verifica."

### N19_ADMIN_NUOVA_SEGNALAZIONE
- **Subject:** `Nuova segnalazione: {tipo} — pratica {codicePratica}`
- **Body:** Link diretto a `/admin/segnalazioni` con dettagli pratica + nota agenzia.

---

## Ordine di implementazione

**Bundle SP-A — Schema + popup pre-invio**
1. Migrazione enum `TransazioneWalletTipo.PENALE_BROKER`, `SegnalazionePraticaTipo`, `SegnalazionePraticaStato`, campi `Pratica` + modello `BrokerDichiarazione` + 3 NotificaTipo
2. Wizard pratica: aggiunta dichiarazione popup come ultimo step (modale finale prima del submit)
3. Server action `submitPraticaAction` accetta `dichiarazioneAccettata` + crea `BrokerDichiarazione`

**Bundle SP-B — Bottone segnala + admin workflow**
4. Bottone "Segnala problema" + form modale in `/pratiche/[id]` lato agenzia
5. Server action `segnalaPraticaAction` + N19 admin
6. Pagina `/admin/segnalazioni` con lista
7. Server action `confermaAnnullamentoConPenaleAction` + `respingiSegnalazioneAction`
8. Template N17 + N18

**Bundle SP-C — Wallet negativo + alert**
9. Banner saldo negativo in `/wallet`
10. Badge "⚠️ N penali" in `/admin/broker`
11. Update copy bottone payout per saldo negativo
12. Constant `MAX_PENALI_BEFORE_ALERT` + alert agli admin

**Test E2E:**
- Broker invia pratica con popup spuntato + log creato
- Agenzia accetta → segnala fermo
- Admin conferma → wallet broker −€50 (storno compenso €25 + penale €25), transazioni create, agenzia rimborsata
- N17/N18 inviate
- Wallet saldo negativo blocca payout

---

## Punti di accordo legale (B-LEGAL)

> Da validare con legale prima di mettere in produzione il popup. Le clausole nel docx sono bozze.

1. Testo popup definitivo + versione firmata in T&C
2. Importo penale "lordi" — IVA implicita?
3. Privacy: log `BrokerDichiarazione` contiene IP — informativa T&C deve coprire trattamento
4. Wallet negativo > 30gg → sospensione: serve clausola sospensione contrattuale
5. Riferimento a `sportello.aci.it` come fonte autorevole — OK metterlo nel popup?
