---
chatbot_visibility: internal
---

# Passaggio Veloce — Sezione Fatturazione (struttura tecnica)

> **Documento interno riservato — Brief CTO.** Fonte: `PassaggioVeloce
> FatturazionePiattaforma.docx`. NON esporre a bot pubblico/clienti.
> Tutti i valori economici sono **LORDI IVA inclusa**.

## 1. Principio generale

La fatturazione è integrata in due punti per ogni profilo:
- **Lista pratiche**: in ogni riga un'icona per scaricare direttamente la fattura della pratica.
- **Sezione Fatturazione dedicata**: pagina con elenco completo, filtri avanzati, ricerca, export multiplo.

## 2. Area ADMIN (Passaggio Veloce)

**2.1 Dashboard KPI**: Fatturato mese corrente (somma €75 lordi verso agenzie); Ricavo
netto PV mese (€50 lordi/pratica); Somme di terzi in wallet (€25 lordi trattenuti per
broker); Payout erogati mese; **Penali incassate mese (€25 per ciascun veicolo segnalato,
addebitate al broker via wallet)**; Fatture non pagate (alert).

**2.2 Lista documenti fiscali**: tabella con data, ID pratica, tipo documento (Fattura PV
€50 / Documento broker €25), agenzia, broker, importo lordo, stato (Pagata/In
attesa/Scaduta), azioni (PDF/XML/mail). Filtri per periodo, tipo, stato, agenzia/broker.
Export: ZIP selezione, CSV periodo (commercialista), riepilogo mese/anno. Le **penali
broker non compaiono qui**: non sono documenti fiscali (fuori campo IVA, art. 15 co. 1
n. 1 D.P.R. 633/1972), sono un movimento wallet `PENALE_BROKER` visibile in "Somme di
terzi" (§2.3) e nello storico wallet del broker.

**2.3 Somme di terzi**: vista separata wallet broker (saldo, totale trattenuto, storico
payout, alert wallet negativo, export mensile per commercialista).

## 3. Area AGENZIA

Vede solo i propri documenti (fatture da pagare a PV). Integrazione in lista pratiche
(icona Fattura PV €50, icona Documento broker €25, badge stato pagamento). Sezione
dedicata con dashboard (pagato mese/anno, da pagare), lista documenti, filtri, export
PDF/XML/ZIP/CSV. L'agenzia vede **entrambi** i documenti per pratica (€50 PV + €25 broker)
per la propria contabilità.

## 4. Area BROKER

Non paga fatture: riceve i documenti fiscali generati per suo conto, centrati su wallet e
trasmissione SDI. Lista pratiche con documento €25 (o €20,49 in base al regime fiscale),
badge stato SDI (Non trasmesso/Trasmesso aggiornato manualmente). Dashboard wallet (saldo
pratiche, saldo affiliazione, totale lordo verso soglia payout, penali, prossimo payout
automatico). Storico payout e penali. Pulsante "Richiedi payout" attivo quando wallet ≥ €500.

## 5. Regole comuni

- **PDF** con logo PV, dati fiscali, numero progressivo, QR code di verifica.
- **XML FatturaPA** conforme, pronto per SDI.
- **CSV** con data, ID pratica, tipo, lordo, IVA, imponibile, soggetto, stato.
- **ZIP**: `/PDF` e `/XML`, naming `AAAAMMGG_IDpratica_tipo`.
- Generazione automatica al completamento pratica; documenti **immutabili** (errore → nota
  di variazione); archiviazione **minimo 10 anni**; notifica email con PDF allegato.

## 6. Requisiti tecnici CTO

- Generazione PDF (Puppeteer o PDFKit) + XML FatturaPA con validazione XSD; numerazione
  progressiva per tipo/soggetto; QR code verifica.
- Storage sicuro con backup (AWS S3 o equivalente), accesso via URL firmato a scadenza,
  retention 10 anni.
- Export ZIP/CSV/PDF on-demand generate **in background** con notifica al completamento.
- Ricerca full-text, filtri per periodo/tipo/stato con contatori, paginazione 50/pagina.
- Email automatica con PDF a ogni documento; alert admin fatture non pagate >15gg; alert
  broker documenti non trasmessi SDI >30gg.

> ⚠️ Sezione critica: i documenti fiscali generati non devono mai essere persi o corrotti. Priorità alta.

> **Nota (2026-07-11):** la penale broker è **€25 per ciascun veicolo effettivamente
> segnalato** (non più flat €25 a pratica). Il compenso della pratica di norma non è
> ancora maturato quando scatta la penale (segnalazione pre-firma) → nulla da stornare
> nel caso normale. Vedi `sistema-penali-broker.md` e clausole 10.4/10.5 dei Termini.
