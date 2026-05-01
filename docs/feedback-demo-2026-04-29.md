# Feedback Demo Soci — 2026-04-29

> Triage del PDF *"Modifiche Passaggio Veloce - Foglio1.pdf"* raccolto dopo la demo del 2026-04-25.
> Documento di lavoro: source of truth resta `piano-implementazione.md`. Questo file serve da **mappa di provenienza** + classificazione + decisioni aperte da chiudere coi soci.

---

## 1. Modello economico consolidato (CHIUSO)

Modello validato in conversazione 2026-04-29 con Alberto. Sostituisce le ipotesi precedenti del piano (FASE 5).

### 1.1 Tipi pratica (da 3 a 2)

| Etichetta UI | Prezzo agenzia | Broker pratica | Nostro lordo | Vincolo |
|---|---|---|---|---|
| **Passaggio di proprietà privato** *(rinominato da "Trapasso netto")* | 75 € fissi | 25 € | 50 € | Singolo, privato → privato |
| **Minivolture multiple** *(assorbe il vecchio "Lotto massivo")* | 15 € × N | 0 € | 15 € × N | Solo commercianti, **N > 1 obbligatorio** (N ≥ 2) |

Cambiamenti rispetto a oggi:
- Sparisce il tipo "Minivoltura singola" (non esiste nel mondo reale).
- "Lotto massivo" non è più una categoria distinta: è il prezzo agevolato delle minivolture multiple.
- Il prezzo non è più scelto né variabile: è derivato dal tipo + numero veicoli.

### 1.2 Affiliazione (sempre a nostro carico, mai aggiunta al prezzo agenzia)

| Tipo pratica | Costo affiliazione totale | 1 referente | 2 referenti |
|---|---|---|---|
| Passaggio di proprietà privato | 10 € fissi | 10 € all'unico referente | 5 € + 5 € |
| Minivolture multiple | 5 € × N veicoli | 5 € × N all'unico referente | 2,50 € × N + 2,50 € × N |

**Regole:**
- Costo affiliazione **invariante** rispetto al numero di referenti (1 vs 2 = stesso esborso per noi).
- "Referente broker" = chi ha portato in piattaforma il broker della pratica.
- "Referente agenzia" = chi ha portato in piattaforma l'agenzia che lavora la pratica.
- **Auto-affiliazione consentita**: se il broker della pratica è anche il referente dell'agenzia, cumula 25 € pratica + sua quota affiliazione. Nessun anti-cumulo.

### 1.3 Wallet — semantica per ruolo

- **Agenzia**: wallet finora inesistente, va creato. Le voci sono **detrazioni** (75/15 in uscita) eccetto le quote affiliazione che entrano come **plus**. Logiche di payout identiche al broker.
- **Broker**: wallet già esistente. Le voci sono **sempre in entrata** (25 € per ogni passaggio privato + quote affiliazione). Mai detrazioni.

### 1.4 UI prezzi — dove mostrarli

Decisione esplicita: il prezzo **non deve influenzare la decisione di accettazione** dell'agenzia.

**Rimuovere:**
- Card pratica nell'inbox agenzia (oggi compare "75 €" sotto al codice).
- Schermata accettazione (oggi: "Accetti questa pratica per X €?" → diventa "Confermi accettazione?").

**Mantenere / introdurre:**
- **Dashboard economica** post-firma: grafico aggregato + dettaglio per pratica già svolta. È l'unico posto dove l'agenzia vede il proprio costo per pratica.
- Profilo agenzia: card "Listino piattaforma" consultabile.
- Onboarding agenzia: schermata di accettazione condizioni economiche una sola volta.
- T&C / contratto agenzia.
- Mail N8 ("addebito programmato") per riconciliazione contabile.

### 1.5 Implicazioni schema (solo nota, non azione)

Da affrontare in commit dedicato di FASE 5:
- `Pratica.feeAgenziaCent` e `creditoBrokerCent` non più input ma derivati dal tipo + numero veicoli.
- Nuovo modello `CommissioneAffiliazione` con FK al referente e al wallet di destinazione.
- Nuovo modello `WalletAgenzia` (oggi solo i broker hanno wallet).
- `Pratica.numeroVeicoli` per minivolture multiple (oggi assente, c'era solo lotto massivo concettuale).

---

## 2. Feedback raw (verbatim per provenienza)

Riferimento: `docs/Modifiche Passaggio Veloce  - Foglio1.pdf`.

### 2.1 Globale
- Password 8 caratteri (oggi 10).

### 2.2 Broker
1. Aggiungere legenda nella pagina nuova pratica (tipo pratica) trapasso netto / minivoltura.
2. Rinominare "Trapasso netto" → "Passaggio di proprietà privato".
3. Aggiungere tipo "Minivolture multiple".
4. Wallet: aggiungere grafico income (come modifiche admin).
5. Lista pratiche: riga cliccabile intera, non solo codice. Telefono ed email mostrati durante invio e in detail.
6. Upload libretto: aggiungere "Scansione" invece di / accanto a "Scatta foto".
7. Payout automatico configurabile sopra 1000 €; payout forzato resta a partire da 500 €.
8. Pagina Team: NON inviti utente, **crei** un account modificabile da te (admin azienda) con dati di ingresso che decidi tu. La mail vera la comunicheranno autonomamente ai dipendenti.
9. Nessuna possibilità di modificare info profilo azienda → l'admin broker deve poter modificare i dati nel profilo aziendale.
10. Wallet movimenti: indicare quale affiliato ha generato ogni accredito.
11. Pratiche: search inline senza pulsante "filtra".

### 2.3 Agenzia
1. (= 8 broker) Crea account utente invece di invito.
2. (= 9 broker) Modifica info profilo azienda.
3. Dashboard agenzia: deve avere il "Wallet affiliazioni".
4. Wallet agenzia: guadagna solo da affiliazioni, payout identico al broker, movimenti taggano l'affiliato sorgente.
5. (duplicato di 4)
6. Lista pratiche: riga cliccabile intera.
7. Search ricerca inline senza "filtra".
8. Inbox: pulsanti Accetta/Rifiuta direttamente sulla riga, non più navigazione al detail.
9. I "round" non vanno mostrati all'agenzia (info interna admin/CTO).
10. Profilo agenzia: casella per upload listino prezzi (uso interno, non visibile a clienti).
11. (vedi §1) Costo non visibile a ogni pratica; è sempre 75 € (25 broker / 50 noi).
12. (duplicato di 8) Accetta/rifiuta nel quadretto richiesta.

### 2.4 Admin
1. Sospendere account agenzia o broker (temporaneamente o totalmente).
2. Vedere in tempo reale credito accumulato che dobbiamo versare a ogni agenzia/broker; per ogni utente vedere numeri live (pratiche/cash).
3. Gestione pratiche: mostrare anche dati di chi ha caricato i doc, chi compra, chi vende, chi svolge — per verifica.
4. **Ruolo "Assistente"**: vede solo gestione pratiche e dati clienti, non dati sensibili nostri (riservati al CEO).
5. **Catalogo contatti**: lista permanente di tutti i numeri ed email di compratori e venditori (asset commerciale).
6. Stesso (3) anche in escalation.
7. Lista pratiche admin: rosse / in accettazione in alto; barra ricerca + filtro rapido.
8. Liste agenzie e utenti: barra ricerca + filtro rapido.
9. **Ristruttura "Lista utenti"**: oggi è promiscua — vanno separate **lista broker** e **lista agenzie**. Click su una entry → drill-in: dati azienda + lista utenti interna + modifica + sospensione.
10. **Dashboard admin annuale/mensile/settimanale** con filtri temporali e grafico:
    - pratiche svolte / non svolte / per stato
    - income nostre, dei broker (pratiche / affiliazione / complessivo), delle agenzie (pratiche / affiliazione)
    - filtri per singola agenzia / broker, finestra temporale
    - filtri per tipo passaggio + flag collettivi
    - **export scaricabile** ("così da poter fare e vendere report")
11. **CRM integrato nel dashboard admin** ("tutto in un unico portale").

### 2.5 Svolgimento pratica (wizard)
1. Step 2 "parti coinvolte": pre-compilare automaticamente nome venditore (= proprietario libretto).
2. Step 2: caricamento documenti identità fronte/retro venditore + acquirente insieme al libretto, **con compilazione automatica** dei dati estratti.
3. Step 2: validazione bloccante CF (oggi fa proseguire con CF errato).
4. **BUG**: una volta selezionati provincia + comune, l'invio si blocca e dà errore.
5. I "flag" (cointestazione, minivoltura, procura) non devono essere selezione manuale: la tecnologia deve interpretarli dal libretto e richiedere i doc di conseguenza.

---

## 3. Triage classificato

### Legenda priorità
- **P0** — Bug bloccante per uso reale, va fixato comunque
- **P1** — Quick win UX (effort ≤ mezza giornata, impact alto su demo follow-up)
- **P2** — Cambio policy / modello: tocca DB o flussi, ~giorni di lavoro
- **P3** — Feature nuova sostanziale: merita spec dedicata, ~settimane

### 3.1 P0 — Bug
| # | Voce | Area codice | Mapping piano |
|---|---|---|---|
| B-01 | Step 2 wizard avanza con CF errato | `pratiche/nuova` (zod schema + UI) | FASE 3.4 |
| B-02 | Provincia + comune → errore in invio | da diagnosticare (azione `submitNuovaPraticaAction`) | FASE 3.4 / 4.1 |

### 3.2 P1 — Quick win UX
| # | Voce | Area codice | Mapping piano |
|---|---|---|---|
| Q-01 | Password policy 10 → 8 | `auth.ts` | FASE 2.2 |
| Q-02 | Legenda tipi pratica nel wizard | `pratiche/nuova` step 1 | FASE 3.4 |
| Q-03 | Rename "Trapasso netto" → "Passaggio di proprietà privato" (UI + enum?) | enum `TipoPratica`, copy UI | FASE 3 + 5 |
| Q-04 | Aggiungere "Minivolture multiple" come tipo, rimuovere "Minivoltura singola" | enum `TipoPratica` + wizard input N veicoli | FASE 3 + 5 |
| Q-05 | Riga cliccabile in lista pratiche broker / agenzia / admin | `pratiche/page.tsx`, `inbox/page.tsx`, `admin/pratiche` | FASE 3.4 / 4.2 / 9 |
| Q-06 | Search inline (no pulsante "filtra") | tutte le liste con filtro | FASE 3.4 / 4.2 / 9 |
| Q-07 | Inbox agenzia: Accetta/Rifiuta inline | `inbox/page.tsx` | FASE 4.2 |
| Q-08 | Nascondere "round" dalla UI agenzia | `inbox/[id]/page.tsx` | FASE 4.1 |
| Q-09 | Telefono + email visibili in detail pratica e durante invio | `pratiche/[id]`, wizard step 2/3 | FASE 3.4 |
| Q-10 | Pre-compila nome venditore step 2 da libretto OCR | wizard step 2 | FASE 3.2 / 3.4 |
| Q-11 | "Scansione" come opzione upload libretto | wizard step 1 (UI + magari API scanner mobile) | FASE 3.1 |
| Q-12 | Admin lista pratiche: rosse / in accettazione in cima + ricerca | `admin/pratiche` | FASE 9 |
| Q-13 | Admin lista agenzie / utenti: ricerca + filtro rapido | `admin/agenzie`, `admin/utenti` | FASE 9 |

### 3.3 P2 — Cambi policy / modello
| # | Voce | Area | Mapping piano | Note |
|---|---|---|---|---|
| C-01 | Nuovo modello prezzo (75 / 15×N + tabella affiliazione §1) | schema Prisma + actions + wallet | FASE 5 + 13 | **Decisione chiusa §1** |
| C-02 | Costo non visibile in inbox/accettazione, solo dashboard economica post-firma | `inbox/*`, dashboard agenzia | FASE 4.2 / 5.2 | |
| C-03 | "Crea account utente" invece di "Invita" per broker e agenzia (con password assegnata da admin azienda) | `Invitation` → `User` con password reset, UI Team | FASE 2.3 | **Decisione aperta §4** |
| C-04 | Modifica profilo azienda (broker + agenzia) | route `/profilo/azienda` con form, server action | FASE 2 | |
| C-05 | Soglia payout automatico configurabile sopra 1000 € (forzato resta 500) | config admin + cron payout | FASE 5.2 | |
| C-06 | Wallet movimenti: tag affiliato sorgente | schema `WalletTransazione` + UI | FASE 13 | |
| C-07 | Wallet agenzie (oggi inesistente, solo per affiliazioni) | nuovo `WalletAgenzia` + payout flow | FASE 13 + 5.2 | |
| C-08 | Documenti CI venditore/acquirente nel wizard step 2 (non più step separato) | ridisegno wizard | FASE 3.3 / 3.4 | |
| C-09 | Tech interpreta flag dal libretto via OCR/IA, niente selezione manuale | gating IA + wizard | FASE 3.2 / 3.3 | dipende da Document AI vero |
| C-10 | Listino prezzi caricabile dal profilo agenzia (interno, non pubblico) | profilo agenzia + storage doc | FASE 8 (lean) | |
| C-11 | Admin dati venditore/acquirente in gestione pratiche e in escalation | UI `admin/pratiche`, `admin/escalation` (dati già in DB) | FASE 9 | |

### 3.4 P3 — Feature nuove (servono spec dedicate)
| # | Voce | Effort indicativo | Mapping piano |
|---|---|---|---|
| F-01 | Sospensione temporanea / totale account broker e agenzia | medio | FASE 9 (estende 7) |
| F-02 | Lista broker e lista agenzie separate, drill-in con utenti aziendali + edit + sospensione | medio | FASE 9 |
| F-03 | Ruolo "Assistente" admin con RBAC granulare (vede pratiche/clienti, non finanziari) | medio-alto, **decisione aperta §4** su perimetro | FASE 14 (nuova) |
| F-04 | Dashboard admin annuale/mensile/settimanale con grafici, filtri tipo+entità, **export scaricabile** | alto | FASE 14 (nuova) |
| F-05 | Catalogo contatti venditori/acquirenti (lista email/telefono permanente) | medio | FASE 14 (nuova) |
| F-06 | CRM integrato nel dashboard admin | **decisione aperta §4** (architetturale) | FASE 14 (nuova) o FASE 10 |
| F-07 | Wallet broker: grafico income (come admin) | basso | FASE 5.2 |
| F-08 | Dashboard agenzia: card Wallet affiliazioni | basso | FASE 13 |

---

## 4. Decisioni — risolte 2026-05-01 con i soci

### D-01 — "Crea account utente" (impatta C-03) → **Opzione A**
L'admin azienda imposta email + password iniziale e comunica le credenziali al dipendente fuori piattaforma. Al primo login è raccomandato il cambio password (UX-only, non bloccante). Implicazione contrattuale: la gestione di credenziali altrui da parte dell'admin azienda va esplicitata in T&C.

### D-02 — Ruolo "Assistente" (impatta F-03) → **matrice definita**

| Cosa | Assistente vede? |
|---|---|
| Lista pratiche + stati + parti coinvolte | ✅ |
| Dati anagrafici venditore/acquirente | ✅ |
| Importi fee per singola pratica | ✅ |
| Saldi wallet broker / agenzia | ✅ |
| Catalogo contatti permanente | ✅ |
| **Dashboard finanziaria admin (income aggregati / grafici)** | ❌ |
| Lista escalation | ✅ |
| Sospensione account | ✅ |
| Assegnazione manuale pratiche in escalation | ✅ |

In sintesi: l'Assistente è "ammnistratore operativo" su pratiche + clienti + wallet + contatti + escalation. **Non** vede solo le metriche aggregate finanziarie (riservate a CEO).

### D-03 — CRM integrato (impatta F-06) → **Opzione B** *(differita)*
Soci optano per CRM nativo dentro la piattaforma. Esiste già uno scheletro CRM più semplice di quanto pensiamo. È un lavoro **parallelo**: lo affrontiamo dopo aver chiuso il blocco principale (Quick Win + decisioni P2/P3 sbloccate). Vapi/Make/Lemlist restano fuori scope MVP.

### D-04 — Cap durata commissione affiliazione → **Opzione A (sempre)**
Le commissioni di affiliazione vengono riconosciute al referente per tutto il tempo in cui il referral fa pratiche, senza limite di durata. Schema `CommissioneAffiliazione.expiresAt` resta nullable (= sempre). FASE 13 popolerà solo righe con `expiresAt = null`.

### D-05 — Soglia payout agenzie → **Opzione A (= broker)**
Forzato manuale ≥ 500 €, automatico configurabile sopra 1000 €. Stesse soglie per broker e agenzie. Una sola sorgente di verità per la config.

### D-06 *(NUOVO)* — Persistenza documenti
Aggiunto dai soci: "tutta la documentazione che viene inserita (codice fiscale, libretto, carta d'identità ecc.) bisogna salvare i file stessi e non solo i dati testuali, i file devono essere consultabili e scaricabili in ogni momento".

Stato attuale del codice:
- ✅ Libretto: salvato su storage + record `Documento` + endpoint `/api/documenti/[id]` per scarico
- ❌ CI fronte/retro venditore + acquirente: **non caricabili** nel wizard step 2 (oggi solo testo)
- ❌ Codice fiscale (foto): idem
- ❌ Procura: idem (richiesta solo in caso di flag)
- ❌ Visura camerale (PG): non caricabile
- ✅ UI consultazione documenti: presente in pratica detail (sezione "Documenti")

Azioni richieste — copre C-08 + estende:
1. Wizard step 2: aggiungere upload CI fronte/retro, CF, e procura (se flag) per venditore + acquirente.
2. Salvataggio: usare provider storage esistente, generare record `Documento` con `owner = VENDITORE | ACQUIRENTE`.
3. UI: pratica detail già lista i documenti. Verificare che il bottone "Scarica" funzioni per tutti i tipi.
4. Visura camerale per parti PG: caricamento opzionale.

---

## 5. Mapping al piano-implementazione

Voci da integrare in `piano-implementazione.md` con tag `[demo-29/04]`:

| Fase | Voci feedback | Stato proposto |
|---|---|---|
| 2.2 Auth | Q-01 | quick win, prossimo chunk |
| 2.3 Multi-utente | C-03 (cambia natura) | **richiede D-01** |
| 2 (estensione) | C-04 | nuova sezione 2.4 "Profilo azienda" |
| 3.1 Storage | Q-11 | quick win |
| 3.2 OCR | Q-10 | gancio già pronto, manca integrazione |
| 3.3 Gating IA | C-08, C-09 | dipende da Document AI reale |
| 3.4 Wizard broker | B-01, B-02, Q-02, Q-03, Q-04, Q-05, Q-09 | mix bug + quick win |
| 4.1 Distribuzione | Q-08 | quick win |
| 4.2 Dashboard agenzia | Q-05, Q-06, Q-07, F-08 | bundle |
| 5.1 / 5.2 Pagamenti / Wallet | C-01, C-02, C-05, F-07 | richiede commit dedicato schema |
| 8 Listini | C-10 | versione lean (no normalizzazione) |
| 9 Admin | Q-12, Q-13, C-11, F-01, F-02 | bundle admin |
| 13 Affiliazione | C-06, C-07 | si incastra con FASE 5 wallet |
| **14 (NUOVA) — Iterazioni post-demo soci** | F-03, F-04, F-05, F-06 | spec dedicate dopo decisioni D-02/D-03 |

---

## 6. Prossimi step proposti

1. ✅ Documento di triage (questo file)
2. ⬜ Aggiornare `piano-implementazione.md`: integra voci con tag `[demo-29/04]`, apri FASE 14
3. ⏸ Diagnosi e fix B-02 (bug provincia/comune) — **non riproducibile** sul main al 2026-05-01 con 4 test (VE, RM, AP+apostrofo, PD); in attesa di info aggiuntive dai soci (provincia/comune usati, descrizione esatta dell'errore, ambiente locale vs Vercel)
4. ⬜ Bundle quick win UI restanti (Q-01, Q-02, Q-05..Q-09, Q-12, Q-13). Q-03/Q-04 già coperti dalla migrazione economica.
5. ✅ Decisioni soci D-01..D-05 raccolte 2026-05-01 (vedi §4 sopra) + D-06 nuovo requisito documenti
6. ⬜ Implementazione C-03 (creazione account, Opzione A), C-04 (modifica profilo azienda), C-05 (soglie payout)
7. ⬜ D-06: upload CI/CF/procura nel wizard step 2 + UI consultazione documenti
8. ⬜ Spec dedicate F-01/F-02 (sospensione + drill-in admin), F-03 (Assistente RBAC con matrice §4), F-04 (Dashboard admin export), F-05 (Catalogo contatti)
9. ⬜ FASE 13 — Sistema affiliazione completo (popolamento `CommissioneAffiliazione` + accredito wallet)
10. ⏳ FASE 14 differita — CRM nativo (D-03 Opzione B), parallelo dopo MVP
11. ✅ Migrazione schema modello economico (commit `8a7317d..62395fe` del 2026-05-01)
