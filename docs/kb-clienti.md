---
chatbot_visibility: clients
---

# Knowledge base — Bot clienti (dealer e agenzie loggati)

> Contenuto curato per il chatbot rivolto agli utenti **loggati** (dealer/broker e
> agenzie). Operatività della piattaforma: come si fa, documenti necessari, stati,
> wallet. **Escluso:** margini PV, split interni, costi aziendali, strategia, note CTO.
> Le fee e le penali che il cliente già vede in piattaforma possono essere citate.

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
2. Compila i dati del veicolo (targa, telaio, anno di immatricolazione) e dichiara la
   situazione (es. comodato d'uso, eventuale fermo).
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
- **Comodato d'uso attivo**: serve il documento di **revoca**; la pratica resta bloccata finché il PRA non è aggiornato.
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
**responsabilità del broker** prima di caricare la pratica. Se invii una pratica con un
veicolo gravato da fermo o ipoteca, la pratica viene annullata: **perdi il compenso di €25**
maturato e ti viene addebitata una **penale di €25** (impatto totale −€50 sul wallet).
Verifica sempre con una visura PRA prima di inviare.

## Come vengono scelte le agenzie

Non scegli l'agenzia manualmente. Alla conferma, la pratica viene distribuita
automaticamente in più round: prima alle agenzie del **comune**, poi (se nessuna accetta in
tempo) ai **comuni limitrofi**, infine a tutta la **provincia**. Le agenzie sono ordinate
per affidabilità (valutazioni reali) e la **prima che accetta** la prende in carico.

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

- Ricevi solo pratiche **complete e già verificate** dalla tua provincia.
- Decidi quali **accettare** in base ai tuoi orari di apertura.
- Lavori la pratica, fissi l'appuntamento per la firma e, a firma avvenuta, la flagghi come completata.
- Il pagamento delle commissioni è automatizzato (a circa 20 giorni dalla firma).
- Un sistema di **ranking trasparente** basato sulle valutazioni reali influenza la distribuzione delle pratiche.

## Wallet e payout (broker)

- I compensi delle pratiche si accumulano nel tuo **wallet**.
- Puoi **richiedere il payout** a partire da **€500**; al raggiungimento di **€1.000** il
  payout parte **automaticamente** (la soglia automatica può essere configurata).
- Nel wallet vedi saldo pratiche, saldo affiliazione, eventuali penali addebitate e il
  prossimo payout previsto.
- Il saldo può diventare **negativo** in caso di penali: in tal caso il payout è bloccato
  finché non reintegri.

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
