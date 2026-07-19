---
chatbot_visibility: clients
---

# Passaggio Veloce — Guida operativa (dealer e agenzie)

## Registrazione e accesso

- Ci si registra come azienda (dealer o agenzia) con una procedura guidata a 4 step:
  dati del titolare, dati azienda (P.IVA, Codice SDI, indirizzo), **documenti**, pagamento e
  condizioni.
- **Documenti per la registrazione**: carta d'identità (fronte e retro), codice fiscale e
  **visura camerale degli ultimi 6 mesi**. La verifica è **automatica** (lettura dei
  documenti); se qualcosa non torna (visura scaduta, codice attività non idoneo, dati non
  corrispondenti) viene segnalato subito.
- Dopo la registrazione si **conferma l'email** tramite il link ricevuto.
- È disponibile l'**autenticazione a due fattori (2FA)** con app authenticator e codici di
  backup, attivabile da Profilo → Sicurezza.
- Un'azienda può avere **più utenti**: l'amministratore può invitarli o crearli da Team.

## Aprire e inviare una pratica (dealer/broker)

1. Crea una nuova pratica e carica il **libretto di circolazione**.
2. Compila i dati del veicolo (targa, telaio, anno di immatricolazione).
3. Indica il **tipo di venditore** e il **tipo di acquirente** (privato, straniero,
   azienda) ed eventuali flag (procura, successione, acquirente minorenne).
4. Carica i documenti richiesti — il wizard ti mostra **la lista esatta** in base alle tue
   risposte e non permette l'invio finché manca qualcosa.
5. Quando tutto è completo, **conferma e invia**: la pratica viene distribuita
   automaticamente alle agenzie della zona.

## Quali documenti servono

La lista dipende dal caso. Regole principali:

**Sempre**
- Libretto di circolazione.
- Veicolo immatricolato **prima del 2015** → anche il **Certificato di Proprietà (CdP)**.

**Lato venditore / acquirente, in base al soggetto**
- **Privato italiano con CIE** (carta d'identità elettronica): solo CI fronte/retro (il
  codice fiscale è già incorporato).
- **Privato italiano con CI cartacea**: CI fronte/retro **+ tessera codice fiscale** fronte/retro.
- **Straniero extra-UE**: CI fronte/retro **+ permesso di soggiorno in corso di validità**
  (permesso scaduto = pratica bloccata).
- **Azienda/società**: **visura camerale rilasciata negli ultimi 6 mesi** + CI dell'amministratore fronte/retro.

**Casi speciali**
- **Vendita tramite procuratore**: atto di procura notarile + CI del procuratore + CI del venditore.
- **Veicolo da successione**: certificato di morte + atto di accettazione eredità +
  dichiarazione di qualità di erede + CI dell'erede.
- **Acquirente minorenne**: autorizzazione del tutore legale + CI del tutore.

**Se la tua situazione non rientra negli schemi standard**: usa "Non trovo la mia
situazione" nel wizard. La pratica resta in bozza e il team la analizza manualmente
(di norma entro 24-48 ore) e ti contatta con le istruzioni sui documenti.

## Verifica obbligatoria prima dell'invio (fermo/ipoteca)

Il **fermo amministrativo** e l'**ipoteca** NON sono visibili sul libretto: si verificano
**solo con una visura PRA** sulla targa (es. su sportello.aci.it). La verifica è
**responsabilità del broker**, per ciascun veicolo, prima di caricare la pratica. Se
l'agenzia segnala un veicolo con fermo o ipoteca e la segnalazione viene confermata dal
team Passaggio Veloce, la pratica viene annullata: il compenso della pratica **non matura**
(matura solo alla firma, che a quel punto non avviene) e ti viene addebitata una **penale di
€25 per ciascun veicolo segnalato** — i veicoli regolari della stessa pratica non pagano
nulla. La penale non è soggetta a IVA. Su una pratica con più veicoli, ad esempio, se solo 1
dei 3 ha un fermo confermato la penale è di €25 (non €75).
Verifica sempre con una visura PRA prima di inviare, per ogni veicolo della pratica.

## Come vengono scelte le agenzie

Non scegli l'agenzia manualmente. Alla conferma, la richiesta viene inviata automaticamente
alle agenzie più vicine al **luogo di consegna** che hai indicato, in cerchi progressivamente
più ampi e in più round: si parte dalle agenzie più vicine e, se nessuna accetta in tempo, il
raggio si allarga per includere altre agenzie via via più distanti. Le agenzie già contattate
nei round precedenti restano libere di accettare finché la pratica non viene presa in carico.
La **prima agenzia che accetta** la prende in carico.

Ogni agenzia ha un tempo per rispondere: il **countdown considera solo gli orari di apertura**
dell'agenzia (non scorre quando è chiusa). Se dopo tutti i round nessuna agenzia accetta, la
pratica passa al team di Passaggio Veloce che interviene manualmente. Da quel momento segui
lo stato della pratica e le notifiche.

## Stati principali della pratica

- **Bozza** — in compilazione o in attesa di revisione manuale.
- **In attesa (round 1/2/3)** — inviata alle agenzie, in attesa che una accetti.
- **In escalation** — nessuna agenzia ha accettato dopo i round; la gestisce il team PV.
- **Accettata** — un'agenzia l'ha presa in carico e la sta lavorando.
- **Processata** — l'agenzia ha completato la lavorazione; manca la firma del cliente.
- **Firmata / Completata** — firma avvenuta in agenzia; la pratica si chiude.
- **Scaduta / Annullata** — countdown esaurito, oppure fermo/ipoteca o problema segnalato.

## Lato agenzia

- Ricevi solo pratiche **complete e già verificate**, per i luoghi di consegna vicini alla tua sede.
- Decidi quali **accettare** in base ai tuoi orari di apertura.
- Lavori la pratica, fissi l'appuntamento per la firma e, a firma avvenuta, la flagghi come completata.
- L'addebito della fee di piattaforma è automatico e avviene **al momento della firma** (addebito immediato tramite mandato SEPA).
- Le valutazioni che ricevi dai dealer restano visibili nel tuo profilo e contribuiscono alla tua reputazione sulla piattaforma.

## Wallet e payout (broker)

- I compensi maturano **alla firma** della pratica e si accumulano liberamente nel tuo
  **wallet**: il saldo è sempre e integralmente tuo, senza scadenza né decadenza.
- Puoi **richiedere il payout** a partire da un saldo di **€500**. Sotto questa soglia non
  perdi nulla: i compensi restano accreditati e continuano ad accumularsi.
- Al raggiungimento della soglia di payout automatico che configuri (di regola €1.000,
  impostabile tra €1.000 e €5.000) l'erogazione parte **automaticamente** via bonifico
  sull'IBAN indicato.
- In caso di chiusura o cancellazione dell'account, il saldo residuo ti viene **liquidato
  integralmente**, anche se è inferiore a €500.
- Nel wallet vedi saldo pratiche, saldo affiliazione, eventuali penali addebitate e il
  prossimo payout previsto.
- Il saldo può diventare **negativo** in caso di penali: in tal caso i prelievi sono
  **sospesi** finché non torna positivo, ma la tua operatività resta invariata (puoi
  continuare a caricare e gestire pratiche).

## Documenti fiscali

A pratica completata, i documenti fiscali (fattura di Passaggio Veloce e documento del
broker) sono gestiti dalla piattaforma secondo il flusso previsto e disponibili dalla
sezione Fatturazione. (La generazione/trasmissione automatica al SDI è in fase di
attivazione.)

## Notifiche

Ricevi notifiche via **email** a ogni passaggio rilevante (invio, accettazione, firma,
addebiti, escalation, segnalazioni). Le notifiche di servizio sono sempre attive; quelle
facoltative (solleciti, promemoria countdown, recap affiliazione, inviti a valutare) si
gestiscono da Profilo → Notifiche, con disiscrizione in un clic dal link in fondo all'email.
Lo storico delle comunicazioni è in Notifiche.
