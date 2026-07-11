---
chatbot_visibility: internal
---

# Passaggio Veloce — Sistema Segnalazioni, Storni e Penali

> **Documento interno riservato — Brief CTO.** Fonte: `PassaggioVeloce
> SegnalazioniPenali.docx`. NON esporre a bot pubblico/clienti (l'avviso visura PRA e
> l'esistenza della penale, in forma qualitativa, sono già in `kb-clienti.md`).

## 1. Il problema

Fermo amministrativo e ipoteca **non** sono visibili sul libretto: solo tramite **visura
PRA** sulla targa. PV non fa visure PRA automatiche (costo/complessità). La verifica è
**responsabilità del broker**; la piattaforma avvisa con banner obbligatorio e applica una
penale se la pratica è inviata con veicolo vincolato.

## 2. Banner di avviso (caricamento documenti)

Banner permanente non dismissibile durante il caricamento, con accordion espandibile sui
dettagli penale. Rimanda a sportello.aci.it. Testo: verifica obbligatoria fermo/ipoteca via
visura PRA prima dell'invio.

## 3-4. Flusso segnalazione → storno (one-click admin)

1. L'**agenzia** rileva fermo/ipoteca → clicca "Segnala problema" (tipo: Fermo/Ipoteca + nota).
2. La segnalazione appare nella pagina **Segnalazioni admin** ("In verifica") + alert al team PV.
3. Il **team PV** verifica (eventuale chiamata) e clicca **"Conferma storno e applica penale"**.
4. **Un solo click** avvia in transazione atomica:
   - Annullamento pratica ("Annullata — fermo/ipoteca").
   - Storno della fee schedulata per l'agenzia (se presente) → l'agenzia non paga nulla.
   - Il compenso broker **non matura**: la segnalazione è sempre pre-firma, quindi non c'è
     nulla da rimuovere dal wallet. Storno solo nell'edge case in cui il compenso fosse già
     stato eccezionalmente accreditato.
   - **Addebito penale di €25 per ciascun veicolo segnalato** al broker (wallet può andare
     negativo; fallback a 1 veicolo per segnalazioni legacy prive del flag `segnalato`).
   - Notifiche a broker e agenzia; aggiornamento segnalazione ("Risolta"); log immutabile.

## 5. Impatto economico

Esempio illustrativo con **1 solo veicolo segnalato** (listino corrente da `/admin/tariffe`,
importi indicativi):

| Soggetto | Normale (senza problemi) | Con fermo/ipoteca confermato | Differenza |
|---|---|---|---|
| Agenzia | paga la fee di piattaforma alla firma | €0 (fee schedulata annullata) | risparmio della fee |
| Broker | matura il compenso alla firma | compenso **non maturato** (pratica annullata prima della firma) + penale di €25 | mancato guadagno + €25 di penale |
| Passaggio Veloce | trattiene la propria quota | €0 di quota ordinaria + €25 di penale | solo la penale |

Su pratiche **multi-veicolo** la penale è **€25 × numero di veicoli segnalati** (non tutti i
veicoli della pratica): 3 veicoli, 1 segnalato → penale €25, non €75.

Forte incentivo per il broker a verificare sempre lo stato di ogni veicolo prima di caricare.

## 6. Pagina Segnalazioni (tre aree)

- **Admin**: lista con filtri (stato/tipo/periodo/agenzia/broker), ricerca, badge contatore
  pendenti; scheda con dettaglio, note interne, 3 azioni ("Conferma storno e applica
  penale", "Rifiuta", "Richiedi info"), log completo.
- **Agenzia**: archivio segnalazioni inviate (sola lettura) con stato e notifiche.
- **Broker**: archivio segnalazioni a suo carico con impatto wallet (nessuna fattura penale: è un movimento wallet fuori campo IVA).

## 7. Requisiti tecnici CTO

- Pulsante "Segnala problema" nelle pratiche Accettata/In lavorazione (tipo problema + nota).
- Banner giallo permanente con accordion + link sportello.aci.it.
- Operazioni storno in **transazione atomica** (tutte o nessuna, rollback su errore), log
  con timestamp, movimento wallet `PENALE_BROKER` tracciato in `TransazioneWallet`,
  notifiche. Nessuna fattura viene generata per la penale: è fuori campo IVA (art. 15,
  co. 1, n. 1, D.P.R. 633/1972) e resta un semplice movimento di wallet.
- Badge contatore pendenti sempre visibile; alert mail team a ogni nuova segnalazione;
  popup di conferma esplicita prima dell'esecuzione (operazione **non reversibile**).

> **Nota (2026-07-11):** la penale è **€25 per ciascun veicolo effettivamente segnalato**
> (non più flat €25 a pratica). Il compenso broker non viene stornato nel caso normale: la
> segnalazione è pre-firma, quindi il compenso semplicemente non matura. Lo storno del
> compenso resta un ramo difensivo per l'edge case in cui fosse già stato eccezionalmente
> accreditato. `sistema-penali-broker.md` e `docs/kb-clienti.md` sono stati allineati.
> Vedi clausole 10.4/10.5 dei Termini (`/termini`).
