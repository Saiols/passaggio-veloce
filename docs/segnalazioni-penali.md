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
   - Storno fee €75 all'agenzia (o nessun addebito) → l'agenzia non paga nulla.
   - Rimozione compenso broker (€25 maturati tolti dal wallet).
   - **Addebito penale €25** al broker (wallet può andare negativo).
   - Generazione fattura penale €25 (TD01) intestata al broker con riferimento pratica.
   - Notifiche a broker e agenzia; aggiornamento segnalazione ("Risolta"); log immutabile.

## 5. Impatto economico

| Soggetto | Normale | Con fermo/ipoteca | Differenza |
|---|---|---|---|
| Agenzia | paga €75 | €0 | risparmio €75 |
| Broker | guadagna €25 | −€25 compenso − €25 penale = **−€50** | −€50 |
| Passaggio Veloce | guadagna €50 | €0 ordinario + €25 penale | solo penale €25 |

Forte incentivo per il broker a verificare sempre lo stato del veicolo prima di caricare.

## 6. Pagina Segnalazioni (tre aree)

- **Admin**: lista con filtri (stato/tipo/periodo/agenzia/broker), ricerca, badge contatore
  pendenti; scheda con dettaglio, note interne, 3 azioni ("Conferma storno e applica
  penale", "Rifiuta", "Richiedi info"), log completo.
- **Agenzia**: archivio segnalazioni inviate (sola lettura) con stato e notifiche.
- **Broker**: archivio segnalazioni a suo carico con impatto wallet, link alla fattura penale.

## 7. Requisiti tecnici CTO

- Pulsante "Segnala problema" nelle pratiche Accettata/In lavorazione (tipo problema + nota).
- Banner giallo permanente con accordion + link sportello.aci.it.
- Operazioni storno in **transazione atomica** (tutte o nessuna, rollback su errore), log
  con timestamp, fattura penale TD01 €25 automatica, notifiche.
- Badge contatore pendenti sempre visibile; alert mail team a ogni nuova segnalazione;
  popup di conferma esplicita prima dell'esecuzione (operazione **non reversibile**).

> **Nota incoerenza (da risolvere):** qui la penale è **€25**; in
> `fatturazione-piattaforma.md` e `sistema-penali-broker.md` compare **€100**. Allineare
> prima di alimentare i bot.
