---
chatbot_visibility: clients
---

# Knowledge base — Bot clienti (dealer e agenzie loggati)

> Contenuto curato per il chatbot rivolto agli utenti **loggati** (dealer/broker e
> agenzie). Operatività della piattaforma: come si fa, documenti necessari, stati,
> wallet. **Escluso:** margini PV, split interni, costi aziendali, strategia, note CTO.
> Le fee che il cliente già vede in piattaforma possono essere citate; gli importi delle
> **penali NON vanno citati in cifra** finché non è risolta l'incoerenza nei documenti.

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
veicolo gravato da fermo o ipoteca, la pratica viene annullata ed è prevista una **penale**
oltre alla perdita del compenso di quella pratica. Verifica sempre prima di inviare.

## Come vengono scelte le agenzie

Non scegli l'agenzia manualmente. Alla conferma, la pratica viene inviata alle agenzie
partner della zona, ordinate per affidabilità; la **prima agenzia che accetta** la prende
in carico. Da quel momento segui lo stato della pratica e le notifiche.

## Stati principali della pratica

- **Bozza** — in compilazione o in attesa di revisione manuale.
- **In attesa (round di distribuzione)** — inviata alle agenzie, in attesa che una accetti.
- **Accettata / In lavorazione** — un'agenzia l'ha presa in carico e la sta gestendo.
- **Firmata / Completata** — firma avvenuta in agenzia; scatta la chiusura e la fatturazione.
- **Annullata** — es. fermo/ipoteca rilevato o problema segnalato.

## Lato agenzia

- Ricevi solo pratiche **complete e già verificate** dalla tua provincia.
- Decidi quali **accettare** in base ai tuoi orari di apertura.
- Lavori la pratica, fissi l'appuntamento per la firma e, a firma avvenuta, la flagghi come completata.
- Il pagamento delle commissioni è automatizzato (a circa 20 giorni dalla firma).
- Un sistema di **ranking trasparente** basato sulle valutazioni reali influenza la distribuzione delle pratiche.

## Wallet e payout (broker)

- I compensi delle pratiche si accumulano nel tuo **wallet**.
- Puoi **richiedere il payout** al raggiungimento della soglia minima; oltre una soglia più
  alta il payout è **automatico**.
- Nel wallet vedi saldo pratiche, saldo affiliazione, eventuali penali addebitate e il
  prossimo payout previsto.

## Documenti fiscali

A pratica completata vengono generati automaticamente i documenti fiscali (PDF e XML
FatturaPA), scaricabili dalla lista pratiche e dalla sezione Fatturazione, e trasmessi al
SDI secondo il flusso previsto.

## Notifiche

Ricevi notifiche multi-canale (email, SMS, in-app) a ogni passaggio rilevante: invio,
accettazione, solleciti, firma, payout, addebiti.
