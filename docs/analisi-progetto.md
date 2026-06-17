# Trapasso Facile - Analisi Completa del Progetto

> Ultimo aggiornamento: 9 aprile 2026 - integrato con Visione Strategica, Policy Prezzi/Valutazioni, Mockup Listino/Roadmap, Organigramma e CRM Struttura Ruoli/Permessi

## 1. Panoramica

**Nome prodotto:** Trapasso Facile
**Tipologia:** SaaS B2B
**Dominio:** Gestione digitale dei passaggi di proprieta veicoli in Italia
**Ideatore:** Alberto De Vivo
**Target primario:** Concessionarie / Dealer auto (commercianti) e Broker
**Target secondario:** Agenzie di pratiche auto

La piattaforma e' un **broker digitale** che connette dealer/commercianti con agenzie di pratiche auto. Non esegue il processo STA, non accede ai registri pubblici (PRA), non trasmette documenti alla motorizzazione. Il valore sta nel garantire che i documenti che arrivano all'agenzia siano **sempre completi e corretti**, eliminando il back-and-forth.

---

## 2. Flusso Operativo (versione definitiva)

### 2.1 Registrazione (identica per dealer/broker e agenzie)
- Riservata a **aziende** (privati previsti in fase futura)
- Dati richiesti:
  - **Amministratore:** Nome, Cognome, Data di nascita, Luogo di nascita, Codice Fiscale
  - **Azienda:** Ragione Sociale, Indirizzo Sede Legale, P.IVA, Codice SDI, PEC, Telefono, Email, Password
  - **Documenti:** CI e CF dell'amministratore, Visura Camerale (max 6 mesi)
  - **Pagamento:** Dati di pagamento, IBAN e autorizzazione all'addebito automatico
  - **Broker:** Dati aziendali, dati di fatturazione e IBAN per il wallet
  - **Termini:** Accettazione T&C con clausola di limitazione responsabilita (include accettazione addebito automatico al giorno 20)
- **Approvazione automatica** - nessuna verifica manuale
- **Multi-utente:** admin + utenti secondari con permessi limitati

### 2.2 Step 1 - Tipo pratica e Caricamento Libretto (Broker)
- **Selezione tipo pratica:** Trapasso netto / Minivoltura / Lotto massivo
- Upload del libretto di circolazione (PDF)
- **IA legge il libretto** ed estrae i dati (targa, telaio, ecc.)
- Se necessario, segnala:
  - Presenza comodato d'uso (informativo, non bloccante)
  - Necessita certificato di proprieta (veicolo pre-10/2015)

### 2.3 Step 2 - Caricamento Documenti Identita (Broker)
Il broker carica i documenti di **entrambe le parti** (venditore e acquirente).

- CI Venditore (fronte/retro)
- CI Acquirente (fronte/retro)
- Codice Fiscale / Tessera Sanitaria entrambe le parti
- Visura Camerale (se azienda)
- Permesso di Soggiorno (se applicabile)
- Procura Notarile + documenti proprietario procurante
- **Flag "Minivoltura":** visura camerale al posto di CI
- **Flag "Cointestazione":** documenti secondo intestatario

**La tecnologia impedisce l'invio di pratiche incomplete.** Ogni documento caricato viene verificato dall'IA per confermare che il tipo di documento corrisponda a quanto richiesto (es. se il campo chiede una CI, il sistema verifica che sia effettivamente una carta d'identita e non un altro documento).

### 2.4 Step 3 - Selezione Comune e Invio (Broker)
- Inserimento **comune preferito** (non provincia)
- Mappa agenzie disponibili nella zona
- **Invio automatico a 5 agenzie** nel comune selezionato
- La **prima agenzia che accetta** si aggiudica la pratica (logica Deliveroo)
- Da definire: cosa succede se nessuna delle 5 accetta (allargamento raggio? notifica al broker?)

### 2.5 Step 4 - Attesa e Conferma (Broker)
- Schermata "Pratica inviata a 5 agenzie - in attesa"
- Notifica quando un'agenzia accetta
- Ricezione **codice pratica** (es. TF-2026-04821) da comunicare ai clienti
- Il codice da "corsia preferenziale" in agenzia

### 2.6 Lotto Massivo (flusso dedicato)
- Per commercianti che acquistano lotti di auto
- **Un solo acquirente**, piu venditori, piu libretti
- Caricamento multiplo in bulk
- Pratiche generate in serie
- Fee: **15 EUR per veicolo**

### 2.7 Dashboard Agenzia
- Ricezione nuove pratiche con pulsante **Accetta / Rifiuta**
- Messaggio "Dossier completo e verificato da Trapasso Facile"
- Download singolo documenti o **ZIP completo**
- **Conferma presa in carico** -> notifica al broker con codice pratica
- Campo **codice pratica interno** agenzia + note interne
- **Countdown** giorni rimasti per la firma (20 giorni)
- **Conferma "Firma avvenuta"** -> chiude la pratica, scatta l'addebito
- **Storico e fee:** riepilogo mensile con pratiche, fee totali, auto-addebiti

### 2.8 I Tre Step Economici (aggiornamento critico dalla v2)

| Step | Azione | Effetto economico |
|------|--------|-------------------|
| 1 - Richiesta | Il broker invia la pratica | Nessuno |
| 2 - Presa in carico | L'agenzia accetta | Nessuno (solo notifica) |
| 3 - Firma avvenuta | L'agenzia flagga la firma | **Addebito fee all'agenzia** |
| Timeout 20gg | Firma non flaggata | **Addebito automatico comunque** |

**CAMBIO RISPETTO A v1:** l'addebito non avviene piu alla presa in carico (Step 2) ma alla firma (Step 3) o al ventesimo giorno, quello che viene prima.

### 2.9 Sistema Notifiche (completo da mockup)

| # | Destinatario | Trigger | Contenuto |
|---|-------------|---------|-----------|
| N1 | Broker | Invio pratica | Conferma invio a 5 agenzie |
| N2 | Broker | Agenzia accetta | Codice pratica + dati agenzia |
| N3 | Broker | Ogni 5 giorni senza firma | Sollecito a far presentare i clienti |
| N4 | Broker | Firma avvenuta | Conferma completamento + credito wallet |
| N5 | Broker | Soglia wallet 1.000 EUR | Payout automatico eseguito + rendiconto |
| N6 | Agenzia | Broker invia pratica | Nuova pratica disponibile (urgenza: altre 4 agenzie) |
| N7 | Agenzia | Countdown attivo | Promemoria firma + giorni rimasti + importo addebito |
| N8 | Agenzia | Giorno 20 senza firma | Addebito automatico eseguito |

---

## 3. Modello di Revenue (v2 - definitivo)

### 3.1 Pricing per tipo di pratica

| Tipo pratica | Fee totale addebitata all'agenzia | Quota Trapasso Facile | Quota Broker (wallet) |
|-------------|----------------------------------|----------------------|----------------------|
| **Trapasso netto** | **75 EUR** | 50 EUR | 25 EUR |
| **Minivoltura singola** | **15 EUR** | 15 EUR | 0 EUR (dealer=broker) |
| **Minivoltura massiva (lotto)** | **15 EUR per veicolo** | 15 EUR per veicolo | 0 EUR |

### 3.2 Listino agenzie

> ⚠️ **STATO (giugno 2026): FEATURE SOSPESA.** Il modulo Listini / Osservatorio Prezzi è attualmente disattivato e nascosto dall'app (UI e route disabilitate). Documentazione conservata per eventuale riattivazione futura. Da NON proporre come funzione disponibile.

Le agenzie applicano un listino fisso mediamente **100 EUR superiore** alla tariffa standard per il trapasso netto. Il cliente paga di piu ma ottiene la corsia preferenziale con il codice pratica. Va comunicato chiaramente:
- Alle agenzie all'iscrizione
- Al cliente finale tramite il broker/dealer

### 3.3 Wallet Broker
Per ogni trapasso netto completato, 25 EUR vengono accreditati nel wallet del broker.

| Soglia wallet | Azione |
|--------------|--------|
| < 500 EUR | Nessun payout, crediti restano nel wallet |
| 500 - 999 EUR | Payout manuale su richiesta del broker |
| >= 1.000 EUR | Payout automatico + rendiconto generato |

Il broker usa il rendiconto per emettere fattura verso Trapasso Facile.

**Da validare con un commercialista prima dello sviluppo del modulo pagamenti.**

### 3.4 Momento dell'addebito
L'addebito avviene al **flagging della firma da parte dell'agenzia (Step 3)** oppure **automaticamente al giorno 20** dalla presa in carico se la firma non viene flaggata. Condizione accettata dall'agenzia alla registrazione.

### 3.5 Proiezione primo anno (target dichiarato)
- 100 commercianti attivi, 50 pratiche ciascuno = **5.000 pratiche/anno**
- Mix stimato (ipotesi 60% trapasso / 40% minivoltura):
  - 3.000 trapasso x 50 EUR = 150.000 EUR (quota TF)
  - 2.000 minivoltura x 15 EUR = 30.000 EUR
  - **Revenue TF stimata: ~180.000 EUR/anno**
  - Payout broker: 3.000 x 25 EUR = 75.000 EUR/anno

---

## 4. Attori del Sistema

| Attore | Ruolo | Dashboard | Paga? |
|--------|-------|-----------|-------|
| **Broker / Dealer** | Commerciante che avvia la pratica | Dashboard Broker | No (usa gratis, guadagna 25 EUR/trapasso) |
| **Agenzia Passaggi** | Esegue materialmente la pratica | Dashboard Agenzia | Si (75 EUR/trapasso, 15 EUR/minivoltura) |
| **Admin piattaforma** | Gestione utenti, pratiche, pagamenti, monitoring | Dashboard Admin | - |
| **Venditore/Acquirente** | Parti della compravendita | Nessun accesso | Pagano IPT/bolli + sovrapprezzo in agenzia |

---

## 5. Analisi SWOT (aggiornata v2)

### Punti di Forza
1. **Nicchia specifica e poco digitalizzata** - Spazio reale per innovare
2. **IA per lettura libretto + validazione documenti** - Automazione con valore concreto
3. **Garanzia completezza documenti** - Killer feature: zero back-and-forth per l'agenzia
4. **Posizionamento leggero** - Broker puro, no STA, no PRA, no certificazioni
5. **Doppio incentivo economico** - L'agenzia riceve pratiche complete, il broker guadagna 25 EUR/trapasso
6. **Competizione tra agenzie** - Modello Deliveroo + ranking basato su qualita
7. **Sistema di valutazione** - Circolo virtuoso: agenzie migliori ricevono piu pratiche
8. **Database prezzi come asset strategico** - Primo e unico in Italia, costruito organicamente quasi a costo zero
9. **Wallet broker** - Fidelizza i broker (soglia minima per incassare)
10. **Roadmap a 3 fasi credibile** - Ogni fase costruisce sulla precedente, con exit strategy chiara

### Punti di Debolezza
1. **Approvazione automatica registrazioni** - Rischio account fraudolenti
2. **Nessuna comunicazione interna** - Dealer e agenzia comunicano via email esterna
3. **Dipendenza dal fisico** - La firma deve comunque avvenire in agenzia
4. **Complessita crescente** - Wallet, rating, listini, osservatorio, enforcement policy si sommano al core
5. **Il cliente finale paga 100 EUR in piu** - Il valore percepito della "corsia preferenziale" deve giustificarlo
6. **Enforcement policy prezzi debole** - Basato solo su segnalazione volontaria del dealer
7. **Rischio "winner takes all" nel ranking** - Agenzie con rating alto monopolizzano le pratiche

### Opportunita
1. **Espansione ai privati (C2C)** - Confermata come fase futura
2. **Osservatorio Prezzi** - Posizionamento come autorita del settore (anno 2-3)
3. **Certificazione agenzie partner** - Revenue aggiuntiva (anno 2-3)
4. **Agenzie branded TF** - Pagamento completo in piattaforma (anno 3+)
5. **Protezione normativa** - Database prezzi come asset in caso di regolamentazione del settore
6. **Verifica targhe e veicoli** - Integrazione banche dati

### Minacce
1. **Competitor** - iPatente, PraticheAuto.it, agenzie tradizionali
2. **Resistenza agenzie** - Devono pagare 75 EUR e applicare +100 EUR al cliente
3. **Chicken-and-egg** - Servono agenzie per attrarre broker e viceversa
4. **Complessita fiscale del wallet** - Flusso rendiconto/fattura da validare
5. **Sensibilita dati listini** - Anche se anonimi, i prezzi sono dati commerciali sensibili

---

## 6. Dashboard Admin (nuovo - da mockup)

Il mockup introduce per la prima volta la dashboard admin con:

### Admin Overview
- Pratiche mese (volume)
- Revenue mese
- Auto-addebiti (numero)
- Nuove registrazioni (dealer + agenzie)
- Payout broker in coda
- Pratiche senza risposta agenzie

### Admin Utenti
- Ricerca per nome, email, P.IVA
- Lista utenti con ruolo (dealer/agenzia), citta, numero pratiche
- Dettaglio singolo utente

### Admin Osservatorio Prezzi (nuovo - da mockup listino/roadmap)

> ⚠️ **STATO (giugno 2026): FEATURE SOSPESA.** Il modulo Listini / Osservatorio Prezzi è attualmente disattivato e nascosto dall'app (UI e route disabilitate). Documentazione conservata per eventuale riattivazione futura. Da NON proporre come funzione disponibile.

- Listini caricati (conteggio)
- Province coperte
- Media nazionale prezzo trapasso netto
- Prezzo massimo rilevato
- Prezzi medi per zona (tabella per citta)
- Soglia: con 50+ listini caricati, possibilita di pubblicare report semestrale "Osservatorio Prezzi TF"

### Da definire ancora
- Gestione dispute/reclami (incluse segnalazioni abusi prezzo dalle valutazioni)
- Blocco/sospensione account (inclusa sospensione automatica per rating < 2.5)
- Report finanziari dettagliati
- Configurazione parametri (numero agenzie per invio, giorni timeout, soglie wallet)

---

## 7. Policy Prezzi e Maggiorazioni (nuovo - da Policy Prezzi)

### 7.1 Principio generale
Trapasso Facile NON ha un listino proprio. Ogni agenzia mantiene il suo prezzo base liberamente. La piattaforma impone contrattualmente **solo la maggiorazione fissa di 100 EUR** sul trapasso netto per clienti con codice TF.

### 7.2 Obblighi contrattuali dell'agenzia
- **Obbligo di applicazione:** +100 EUR su ogni trapasso netto TF (accettato alla registrazione con firma digitale T&C)
- **Divieto di sovraccarico:** non puo applicare piu di 100 EUR attribuendoli a TF, ne intestarli come voce propria del listino
- **Liberta sul prezzo base:** il prezzo standard dell'agenzia e' completamente libero

### 7.3 Struttura maggiorazioni per tipo pratica

| Tipo | Maggiorazione cliente | Fee agenzia -> TF | Note |
|------|----------------------|-------------------|------|
| Trapasso netto | +100 EUR | 75 EUR (50 TF + 25 broker) | Obbligatoria |
| Minivoltura | Nessuna | 15 EUR (tutto TF) | Solo fee piattaforma |
| Lotto massivo | Nessuna | 15 EUR/veicolo (tutto TF) | Per ogni veicolo |

---

## 8. Sistema di Valutazione Agenzie (nuovo - da Policy Prezzi)

### 8.1 Meccanismo
- Dopo che l'agenzia flagga la firma (Step 3), il **dealer riceve una notifica** per valutare l'esperienza
- **5 stelle + campo note opzionale**
- Il dealer raccoglie il feedback dal cliente finale (unico punto di contatto sulla piattaforma)

### 8.2 Impatto sull'algoritmo di distribuzione

| Rating medio | Priorita | Effetto |
|-------------|----------|---------|
| 4.5 - 5.0 | Massima | Riceve notifiche per prima nella zona |
| 3.5 - 4.4 | Standard | Ordine normale |
| 2.5 - 3.4 | Ridotta | Meno notifiche, scalata in coda |
| Sotto 2.5 | **Sospensione** | Revisione da parte dell'admin |

- **Soglia minima:** il ranking entra in vigore dopo **almeno 5 valutazioni**. Sotto, l'agenzia e' trattata come rating neutro
- **Il ranking NON e' pubblico.** Non visibile ne a dealer ne ad agenzie. E' un parametro interno

### 8.3 Tutela contro abusi di prezzo
Se il dealer segnala nelle note che l'agenzia ha applicato prezzi superiori o ha attribuito costi non autorizzati a TF, la segnalazione va all'admin per verifica. In caso di conferma: sospensione o rimozione dalla piattaforma.

---

## 9. Raccolta Listini e Database Prezzi (nuovo - da Visione Strategica)

> ⚠️ **STATO (giugno 2026): FEATURE SOSPESA.** Il modulo Listini / Osservatorio Prezzi è attualmente disattivato e nascosto dall'app (UI e route disabilitate). Documentazione conservata per eventuale riattivazione futura. Da NON proporre come funzione disponibile.

### 9.1 Raccolta volontaria
- **Popup post-registrazione:** appare una sola volta al primo login, non bloccante, skippabile
- Sempre accessibile dalla sezione Profilo dell'agenzia
- Due modalita: upload file (PDF/Word) oppure compilazione form strutturato
- Dati normalizzati dal sistema per renderli comparabili

### 9.2 Dati raccolti
- Prezzo base trapasso netto (form o PDF)
- Prezzo minivoltura (form o PDF)
- Maggiorazioni casi speciali (ipoteca/vincolo)
- Zona geografica (automatico da registrazione)
- Feedback dealer sui prezzi (da sistema valutazione)
- Segnalazioni prezzi anomali (da sistema valutazione)
- Volume pratiche per agenzia (automatico)

### 9.3 Profilo agenzia - posizionamento
L'agenzia con listino caricato vede nel suo profilo il **posizionamento rispetto alla media della zona** (dato aggregato anonimo). Es: "Media zona Roma: 195 EUR - Tu: 180 EUR (-8%)"

### 9.4 Valore strategico
Con sufficiente volume di dati, TF dispone del **primo database nazionale aggiornato e verificato** sui prezzi reali dei passaggi di proprieta in Italia. Questo dato non esiste in nessuna fonte pubblica o privata.

Utilizzi:
- **Breve termine:** monitoraggio prezzi anomali, comunicazione commerciale verso nuove agenzie, info al dealer
- **Medio termine:** report semestrali "Osservatorio Prezzi TF", benchmark per agenzie, tariffario di riferimento volontario
- **Lungo termine:** asset per investitori, interlocutore privilegiato con istituzioni, protezione in caso di evoluzione normativa

---

## 10. Roadmap Strategica (nuovo - da Visione Strategica)

### Fase 1 - Intermediazione documentale (Anno 1 - ORA)
Broker digitale puro. Raccolta dati in background.

| Obiettivo | Metrica | Orizzonte |
|-----------|---------|-----------|
| 100 dealer attivi | 100 registrati e operativi | Anno 1 |
| 50 agenzie partner | 50 agenzie con almeno 5 pratiche/mese | Anno 1 |
| 5.000 pratiche processate | 5.000 completate | Anno 1 |
| Database prezzi iniziale | Almeno 30 listini caricati | Anno 1 |
| Sistema valutazioni operativo | Rating disponibile per tutte le agenzie attive | Anno 1 |

Revenue: fee per pratica (75 EUR trapasso / 15 EUR minivoltura)

### Fase 2 - Intelligence di mercato e standard di qualita (Anno 2-3)
Certificazione volontaria agenzie partner. Badge qualita. Osservatorio Prezzi semestrale.

- Agenzie certificate: badge visibile ai dealer, accesso prioritario pratiche, condizioni migliorate
- Pubblicazione "Osservatorio Prezzi Trapasso Facile" - posizionamento come autorita del settore
- Tariffario di riferimento TF adottabile volontariamente
- Benchmark anonimo per le agenzie sulla loro zona

Revenue: fee per pratica + revenue da certificazione agenzie partner

### Fase 3 - Agenzie branded Trapasso Facile (Anno 3+)
Agenzie che operano esclusivamente/prevalentemente su TF con listino standardizzato nazionale. Pagamento completo in piattaforma (bolli, IPT, tariffa, tutto).

- Modello Facile.it: da comparatore a produttore diretto
- Esperienza cliente uniforme su tutto il territorio
- Prima conformita in caso di nuova normativa tariffaria

Revenue: revenue share sul pagamento completo processato in piattaforma

### Protezione normativa
Se TF cresce e attira attenzione regolatoria, il database prezzi e gli standard volontari gia implementati diventano un vantaggio: primo operatore conforme, interlocutore privilegiato con le istituzioni.

---

## 11. Analisi Tecnica (aggiornata)

### Stack ipotizzato
- **Frontend:** React/Next.js (web app responsive, no mobile nativo)
- **Backend:** Node.js o Python (API REST)
- **Database:** PostgreSQL
- **Storage:** S3-compatible, encryption at rest
- **IA/OCR:** GPT-4o Vision / Google Document AI / AWS Textract
- **Email:** Servizio transazionale + scheduler per solleciti ricorrenti
- **Mappe:** Google Maps o Mapbox
- **Auth:** JWT + verifica email/PEC + ruoli multi-utente
- **Pagamenti:** Stripe (addebito automatico SEPA/card + payout broker)
- **Scheduler:** Cron jobs per solleciti (ogni 5gg), auto-addebiti (giorno 20), payout automatici (soglia 1.000)

### Complessita stimate per modulo

| Modulo | Complessita | Note |
|--------|-------------|------|
| Auth + Registrazione + Multi-utente | Media-Alta | Registrazione automatica, ruoli, autorizzazione pagamento |
| Upload e storage documenti | Media | Encryption at rest, download ZIP |
| Validazione completezza documenti | **Molto Alta** | Core feature: ogni upload verificato dall'IA per tipo documento (CI e' davvero una CI, non altro). Classificazione + completezza |
| OCR/IA lettura libretto | Alta | Core feature, fallback manuale necessario |
| Dashboard Broker (4 step + gestione pratiche) | Media-Alta | Tipo pratica, invio multiplo, stato pratiche |
| Lotto massivo | Media | Caricamento bulk, un acquirente N venditori |
| Dashboard Agenzia | Media | Accetta/rifiuta, download, countdown, flagging firma |
| Wallet broker + payout | Alta | Soglie, payout manuali/automatici, rendiconti |
| Sistema addebiti | Alta | Addebito a firma o auto al giorno 20, SEPA |
| Sistema notifiche + solleciti | Media-Alta | 8 tipi di notifica, scheduling ricorrente |
| Selezione agenzie su mappa | Media | Ricerca per comune, 5 agenzie piu vicine, logica primo-che-accetta |
| Fatturazione elettronica (SDI) | Alta | Fatturazione italiana |
| Admin panel | Media-Alta | Overview, gestione utenti, monitoring |
| Sistema valutazione agenzie | Media | 5 stelle + note, impatto su algoritmo distribuzione, soglia 5 reviews |
| Raccolta listini prezzi | Media | Popup post-registrazione, form strutturato o upload PDF, normalizzazione dati |
| Osservatorio Prezzi (admin) | Bassa-Media | Aggregazione anonima, medie per zona, dashboard admin |
| Profilo agenzia con benchmark | Bassa | Posizionamento vs media zona |
| Algoritmo distribuzione con ranking | Media-Alta | Priorita basata su rating, gestione soglie, sospensione automatica |

---

## 12. Criticita e Rischi Tecnici

1. **Complessita del modulo pagamenti** - Tre tipologie di fee, wallet con soglie, payout manuali e automatici, rendiconti, auto-addebito al giorno 20, fatturazione elettronica. **Da validare con commercialista prima dello sviluppo**
2. **"Documenti sempre completi" e' una promessa forte** - Serve validazione IA rigorosa per tipo documento, scadenza, fronte/retro, leggibilita
3. **Race condition invio multiplo** - 5 agenzie ricevono la stessa pratica, serve gestione concorrente robusta
4. **Auto-addebito al giorno 20** - Serve audit trail impeccabile e notifiche chiare
5. **Affidabilita OCR** - Fallback manuale necessario
6. **GDPR** - Dati sensibili, encryption, data retention, informativa privacy
7. **Flusso fiscale wallet** - Rendiconto/fattura broker ha implicazioni fiscali da validare
8. **Scalabilita storage** - ~10+ file per pratica, 5.000 pratiche/anno = 50.000+ file anno 1
9. **Algoritmo distribuzione con ranking** - L'ordine in cui le agenzie ricevono le notifiche dipende dal rating. Serve che sia equo e trasparente internamente, anche se non pubblico. Rischio: agenzie nuove (senza 5 valutazioni) potrebbero restare a lungo in "neutro" senza ricevere abbastanza pratiche per costruire un rating
10. **Enforcement della policy prezzi** - Come verifichiamo che l'agenzia applichi davvero +100 EUR e non di piu? L'unico meccanismo e' la segnalazione del dealer post-firma. Se il dealer non segnala (perche non sa quanto dovrebbe costare), l'abuso passa inosservato
11. **Dati listini sensibili commercialmente** - Anche se aggregati in forma anonima, i prezzi delle agenzie sono dati commerciali sensibili. Se dovesse emergere che sono identificabili, rischio legale e di fiducia

---

## 13. Domande Residue

### Risolte
1. ~~Come validiamo che i documenti siano "completi e corretti"?~~ **Risposta: validazione attiva.** Ogni documento caricato deve essere verificato dall'IA per tipo (se il campo richiede una CI, il sistema deve confermare che il file sia effettivamente una CI e non un altro documento). Non basta la presenza del file: serve classificazione automatica del tipo di documento.

### In attesa
2. **Cosa succede se nessuna delle 5 agenzie accetta?** Allargamento automatico del raggio? Notifica al broker? Timeout? **In attesa di risposta**
3. **Il modello wallet/rendiconto/fattura e' stato validato da un commercialista?** **In attesa di validazione commercialista**

### Ancora aperte
4. Le agenzie hanno sistemi informatici con cui integrarsi?
5. In quale area geografica si parte?
6. Chi sono i competitor diretti?
7. L'approvazione automatica delle registrazioni non comporta rischi?

---

## 14. Giudizio Complessivo (aggiornato - 9 aprile 2026)

### Il progetto ha una visione strategica chiara e ambiziosa.

Con i tre nuovi documenti, il quadro e' ora completo: non solo un prodotto, ma una **strategia a 3 fasi** con un percorso evolutivo da broker a piattaforma proprietaria.

**Cosa funziona:**
- Il modello a tre attori (broker, agenzia, piattaforma) con incentivi per tutti e' ben pensato
- Il broker guadagna 25 EUR/trapasso -> incentivo forte
- La competizione tra agenzie (Deliveroo) incentiva velocita e qualita
- Il wallet fidelizza i broker
- La raccolta listini e' un'idea strategicamente brillante: costruire un asset (database prezzi) che nessun competitor ha, quasi senza costo, in modo organico
- La roadmap a 3 fasi e' credibile: ogni fase costruisce sulle fondamenta della precedente
- Il sistema di valutazione crea un circolo virtuoso: agenzie migliori ricevono piu pratiche
- La policy prezzi e' chiara e contrattualmente definita
- La protezione normativa e' un pensiero di lungo termine intelligente

**Cosa preoccupa:**
- La **complessita totale del progetto e' cresciuta molto**: al core (documenti + pratiche) si aggiungono wallet, rating, listini, osservatorio, enforcement policy prezzi
- Il **modulo pagamenti resta il piu critico** e va validato col commercialista
- Il cliente finale paga **+100 EUR**: la "corsia preferenziale" deve essere percepita come valore reale
- L'**enforcement della policy prezzi** si basa solo su segnalazione del dealer: meccanismo debole
- L'**algoritmo di distribuzione basato su rating** potrebbe creare un effetto "ricchi sempre piu ricchi" (agenzie con rating alto ricevono piu pratiche -> piu valutazioni positive -> rating ancora piu alto)
- La **Fase 3** (agenzie branded) e' un cambio di paradigma che richiede competenze e risorse completamente diverse. E' corretto tenerla come visione, ma non come piano

### Prossimi passi
1. Validazione commercialista sul modello wallet/fatturazione
2. Risposta su cosa succede se nessuna delle 5 agenzie accetta
3. PRD tecnico e architettura del sistema
4. Definizione MVP: cosa sviluppare per il lancio, cosa rimandare a post-lancio
5. Chiarire il naming definitivo: "Trapasso Facile" vs "Passaggio Veloce" (usato nel doc CRM)
6. Definire il team Sales & Business Dev (attualmente "da definire" nell'organigramma)

---

## 15. Struttura Organizzativa (nuovo - da Organigramma aprile 2026)

### 15.1 Team fondatore

| Ruolo | Persona | Tipo | Responsabilita principali |
|-------|---------|------|--------------------------|
| **Fondatore Strategico** | Alberto De Vivo | Strategy & Consulting | Linee guida strategiche, mercato e posizionamento, brevetti e IP, relazioni investitori/partner, roadmap evolutiva, consulenza continuativa |
| **Fondatore Operativo / CEO** | Andrea Saino | Amministratore | Gestione operativa quotidiana, supervisione aree aziendali, relazioni dealer/agenzie/partner, rappresentanza legale, admin piattaforma e CRM, coordinamento team commerciale |
| **Socio Fondatore / CTO** | (da identificare) | Technology | Sviluppo e manutenzione piattaforma, architettura gating documentale, integrazione AI/OCR, sicurezza e infrastruttura cloud, assistenza tecnica continua, continuita del sistema |

### 15.2 Collaboratori esterni e team

| Ruolo | Tipo | Responsabilita |
|-------|------|----------------|
| **Commercialista / CFO esterno** | Esterno - Finance | Contabilita e bilancio, consulenza fiscale e tributaria, supervisione modulo pagamenti e wallet, adempimenti fiscali, validazione modello revenue e rendiconti |
| **Sales & Business Dev** | Da definire | Onboarding nuovi dealer e commercianti, onboarding agenzie pratiche auto, gestione relazioni commerciali con partner, supporto operativo dealer sulla piattaforma, reportistica periodica all'amministratore |

### 15.3 Due sistemi distinti

L'architettura prevede **due piattaforme separate**:

1. **Piattaforma Software (Trapasso Facile)** - Il prodotto rivolto a dealer e agenzie
   - AI, Database, Gestione pratiche, Gating System, Wallet, Notifiche, Rendiconti

2. **CRM Commerciale** - Strumento interno per il team di Trapasso Facile
   - Gestione lead, promemoria, notifiche
   - Usato dal team Sales & Business Dev per acquisire e gestire dealer e agenzie
   - Admin: Andrea Saino (CEO)

---

## 16. CRM Interno - Ruoli e Permessi (nuovo - da CRM Struttura Ruoli Permessi)

### 16.1 Gerarchia dei ruoli (6 livelli)

| # | Ruolo | Accesso CRM | Dashboard operativa | Dashboard economica | Gestione utenti | Matrice permessi |
|---|-------|-------------|--------------------|--------------------|----------------|-----------------|
| 1 | **Admin** | Completo | Si | Si | Tutti (inclusi Admin) | Si |
| 2 | **AD** | Completo | Si | Si | Tutti tranne Admin | Si |
| 3 | **CTO** | Completo | Si | Si | Tutti tranne Admin | Si |
| 4 | **CFO** | Nessuno | No | Solo lettura | Nessuno | No |
| 5 | **Sales Manager** | Completo | Si | No | Solo Sales | No |
| 6 | **Sales** | Solo contatti assegnati | No | No | Nessuno | No |

### 16.2 Logica di sicurezza
- L'**Admin e' al vertice assoluto**: nessun altro ruolo puo modificare o eliminare l'account Admin
- **AD e CTO** hanno lo stesso livello operativo (motivazione: il CTO ha gia accesso diretto ai sistemi tecnici)
- **CFO** vede solo i numeri, zero operativita (coerente con il ruolo esterno del commercialista)
- **Sales Manager** gestisce il team commerciale e il CRM, ma non vede dati economici
- **Sales** ha accesso minimo: solo i propri contatti assegnati, senza possibilita di eliminare

### 16.3 Matrice permessi dettagliata

| Funzione | Admin | AD | CTO | CFO | Sales Mgr | Sales |
|----------|-------|----|-----|-----|-----------|-------|
| CRM - visualizza contatti | ✓ | ✓ | ✓ | — | ✓ | ✓ (assegnati) |
| CRM - aggiunge/modifica | ✓ | ✓ | ✓ | — | ✓ | ✓ (assegnati) |
| CRM - elimina contatti | ✓ | ✓ | ✓ | — | ✓ | — |
| Dashboard operativa | ✓ | ✓ | ✓ | — | ✓ | — |
| Dashboard economica | ✓ | ✓ | ✓ | Solo lettura | — | — |
| Utenti - visualizza lista | ✓ | ✓ | ✓ | — | ✓ (Sales) | — |
| Utenti - crea account | ✓ | ✓ (no Admin) | ✓ (no Admin) | — | ✓ (solo Sales) | — |
| Utenti - modifica/pwd | ✓ | ✓ (no Admin) | ✓ (no Admin) | — | ✓ (solo Sales) | — |
| Utenti - elimina account | ✓ | ✓ (no Admin) | ✓ (no Admin) | — | ✓ (solo Sales) | — |
| Matrice permessi | ✓ | ✓ | ✓ | — | — | — |

### 16.4 Account predefiniti al lancio

| Nome | Ruolo | Email |
|------|-------|-------|
| Alberto De Vivo | Admin | alberto@passaggioveloce.it |
| Andrea Saino | AD | andrea@passaggioveloce.it |
| Dev CTO | CTO | cto@passaggioveloce.it |
| CFO Finance | CFO | cfo@passaggioveloce.it |
| Sales Manager | Sales Manager | manager@passaggioveloce.it |
| Sales User | Sales | sales@passaggioveloce.it |

> **Nota:** le email usano il dominio @passaggioveloce.it. Da chiarire se il nome definitivo del prodotto e' "Trapasso Facile" o "Passaggio Veloce".
