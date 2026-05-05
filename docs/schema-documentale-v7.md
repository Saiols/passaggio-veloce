# Passaggio Veloce — Schema Documentale v7

> Sorgente: `docs/PassaggioVeloce SchemaDocumentale v7.pdf` (aprile 2025).
> Owner: CTO Francesco Sioli. Decisioni post-allineamento 2026-05-05.
> Source-of-truth dell'engine documentale.

---

## Obiettivo

Determinare deterministicamente la **lista esatta di documenti richiesti** per ogni pratica in base a un albero decisionale di 8-9 variabili lato venditore + lato compratore. Output finale ai sensi del flusso:

- **Tutti i documenti caricati e validi** → pratica passa a `IN_ATTESA_ROUND_1` e va in distribuzione automatica
- **Documenti mancanti / scaduti** → wizard non permette il submit, mostra al broker la lista esatta dei mancanti
- **Caso non riconosciuto / dubbio** → flag `richiedeRevisioneManuale=true`, pratica resta `BOZZA` con notifica al team PV per review entro 24-48h

---

## Decisioni prese (2026-05-05)

| # | Tema | Decisione |
|---|---|---|
| 1 | OCR / AI validazione | **MVP senza AI**: broker dichiara campi (data, validità) lato form, no OCR automatico. AI integrata in FASE 11 quando attiviamo Google Document AI. |
| 2 | Mini voltura | Estensione di `MINIVOLTURE_MULTIPLE` con `numeroVeicoli >= 1` (oggi `>= 2`). Niente nuovo enum tipo. |
| 3 | Verifica date validità | Broker compila campo data → validazione applicativa (responsabilità broker, allineata al sistema penali). |
| 4 | Caso non riconosciuto | Flag `richiedeRevisioneManuale` + notifica team. Niente nuovo stato `IN_REVISIONE_MANUALE`. |
| 5 | Wizard layout | Step dinamici condizionali (opzione A): si adattano alle risposte del broker. |
| 6 | Documenti mancanti post-submit | In MVP nessun nuovo stato. Se l'AI futura troverà mancanti dopo submit, aggiungeremo `INTEGRAZIONE_RICHIESTA`. Per ora: validazione applicativa pre-submit blocca. |
| 7 | Tipo soggetto venditore/compratore | Nuovi enum + campi su `Pratica` (vedi schema). |
| 8 | Visura PRA | NON automatica (vedi `sistema-penali-broker.md`). Lo schema PDF parla di "Visura PRA automatica" ma è obsoleto: rimosso. |

---

## Albero decisionale

### Lato VENDITORE

```
1. Anno immatricolazione veicolo:
   ├── ≥ 2015: nessun documento extra
   └── < 2015: + Certificato di Proprietà (CdP)

2. Comodato d'uso attivo:
   ├── No: procede normalmente
   └── Sì: + documento di revoca → BLOCCO finché PRA non aggiornato

3. Tipo venditore (chi è):
   ├── Privato → passaggio standard
   └── Operatore auto / commerciante → MINIVOLTURE_MULTIPLE (tipo singolo o multiplo)

4. Fermo amministrativo:
   ├── Nessuno: ok
   └── Rilevato: BLOCCO immediato — il fermo va cancellato prima
   (NB: la verifica è dichiarata dal broker, vedi sistema penali)

5. Persona fisica italiana — Tipo CI:
   ├── CIE elettronica (nuova): solo CI fronte+retro (CF già incorporato)
   └── CI cartacea (vecchia): CI fronte+retro + Tessera CF fronte+retro

6. Straniero extra-UE:
   └── CI fronte+retro + Permesso di soggiorno
       ├── Validità in corso: ok
       └── Permesso scaduto: BLOCCO pratica

7. Azienda / Società:
   └── Visura camerale
       ├── ≤ 6 mesi: accettata
       └── > 6 mesi: rifiutata, serve nuova
       + CI amministratore F+R

8. Vendita tramite procuratore:
   ├── No (venditore presente): nessun doc extra
   └── Sì (FLAG procura):
       + Atto procura notarile
       + CI procuratore F+R
       + CI venditore originale F+R

9. Veicolo da successione ereditaria:
   ├── No (proprietario vivo): nessun doc extra
   └── Sì (FLAG successione):
       + Certificato di morte
       + Atto accettazione eredità
       + Dichiarazione qualità erede
       + CI erede venditore F+R
```

### Lato COMPRATORE

```
1. Tipo compratore:
   ├── Persona fisica italiana → CI F+R (CIE: solo CI / CI cartacea: + Tessera CF)
   ├── Straniero extra-UE → CI F+R + Permesso (scaduto = BLOCCO)
   └── Azienda / Società → Visura ≤6 mesi + CI amministratore F+R

2. Compratore minorenne:
   ├── No (maggiorenne): nessun doc extra
   └── Sì (FLAG minore):
       + Autorizzazione tutore legale
       + CI tutore legale F+R
```

### Esiti

```
1. Tutti i documenti caricati + validi
   → Pratica inviata automaticamente all'agenzia (IN_ATTESA_ROUND_1)

2. Documenti mancanti / scaduti
   → MVP: wizard non permette submit, mostra al broker lista mancanti
   → Futuro AI: post-submit, AI flagga mancanti, stato INTEGRAZIONE_RICHIESTA

3. Caso non riconosciuto / dubbio (es. documento non standard)
   → Flag richiedeRevisioneManuale=true → pratica resta BOZZA
   → Notifica al team PV → review entro 24-48h
```

---

## Schema impacts

```prisma
// Nuovi enum tipi soggetto
enum TipoSoggetto {
  PRIVATO_ITALIANO_CIE      // Persona fisica italiana con CIE elettronica
  PRIVATO_ITALIANO_CARTACEA // Persona fisica italiana con CI cartacea
  STRANIERO_EXTRA_UE
  AZIENDA
  OPERATORE_AUTO            // Solo lato venditore: dealer/commerciante
}

// Nuovo enum motivo revisione manuale
enum MotivoRevisioneManuale {
  DOCUMENTO_NON_STANDARD
  CASO_NON_PREVISTO_DA_SCHEMA
  RICHIESTA_BROKER
}

model Pratica {
  // ... campi esistenti

  // Variabili albero decisionale lato VENDITORE
  annoImmatricolazione    Int?
  comodatoAttivo          Boolean       @default(false)
  fermoDichiarato         Boolean       @default(false)        // Se broker dichiara fermo (BLOCCO)
  venditoreTipoSoggetto   TipoSoggetto?
  venditoreVisuraData     DateTime?     @db.Date              // Se azienda
  venditorePermessoData   DateTime?     @db.Date              // Se straniero
  flagProcura             Boolean       @default(false)
  flagSuccessione         Boolean       @default(false)

  // Variabili lato COMPRATORE
  acquirenteTipoSoggetto  TipoSoggetto?
  acquirenteVisuraData    DateTime?     @db.Date
  acquirentePermessoData  DateTime?     @db.Date
  flagMinore              Boolean       @default(false)

  // Casi speciali
  richiedeRevisioneManuale Boolean      @default(false)
  motivoRevisione          MotivoRevisioneManuale?
  noteRevisione            String?
  revisioneCompletata      Boolean      @default(false)
  revisioneCompletataAt    DateTime?
  revisioneCompletataDaId  String?      @db.Uuid
}

// Estensione documentTipo (alcuni esistono già)
enum DocumentoTipo {
  // ... esistenti: LIBRETTO_CIRCOLAZIONE, CI_FRONTE, CI_RETRO,
  //               CODICE_FISCALE, PROCURA, PERMESSO_SOGGIORNO,
  //               VISURA_CAMERALE, CERTIFICATO_PROPRIETA, ALTRO
  REVOCA_COMODATO          // NEW
  CERTIFICATO_MORTE        // NEW (successione)
  ATTO_ACCETTAZIONE_EREDITA // NEW
  DICHIARAZIONE_QUALITA_EREDE // NEW
  AUTORIZZAZIONE_TUTORE    // NEW (compratore minorenne)
}
```

Migrazioni stimate: 2
- `add_schema_documentale_v7_fields` — campi pratica + enum TipoSoggetto + MotivoRevisioneManuale
- `add_documento_tipi_v7` — enum DocumentoTipo nuovi valori

---

## Engine documentale (algoritmo)

`packages/lib/src/documenti/engine.ts` — pure function, testabile, nessun side-effect:

```typescript
export type DocumentoRichiesto = {
  tipo: DocumentoTipo;
  parte: 'VENDITORE' | 'ACQUIRENTE' | 'VEICOLO' | 'PROCURA' | 'EREDE' | 'TUTORE';
  obbligatorio: true;
  motivo: string; // es. "Veicolo immatricolato pre-2015"
};

export type EsitoSchemaDocumentale =
  | { kind: 'OK'; documentiRichiesti: DocumentoRichiesto[] }
  | { kind: 'BLOCCO'; motivo: string; soluzione: string }
  | { kind: 'REVISIONE_MANUALE'; motivo: MotivoRevisioneManuale };

export function calcolaDocumentiRichiesti(p: Partial<Pratica>): EsitoSchemaDocumentale {
  // 1. BLOCCHI immediati
  if (p.fermoDichiarato) return { kind: 'BLOCCO', ... };
  if (p.comodatoAttivo) return { kind: 'BLOCCO', ... }; // finché non revocato
  if (p.venditoreTipoSoggetto === 'STRANIERO_EXTRA_UE' &&
      isExpired(p.venditorePermessoData)) return { kind: 'BLOCCO', ... };
  if (p.acquirenteTipoSoggetto === 'STRANIERO_EXTRA_UE' &&
      isExpired(p.acquirentePermessoData)) return { kind: 'BLOCCO', ... };

  // 2. Visura azienda > 6 mesi
  if (p.venditoreTipoSoggetto === 'AZIENDA' &&
      isVisuraScaduta(p.venditoreVisuraData)) return { kind: 'BLOCCO', ... };
  // (idem acquirente)

  // 3. Costruzione lista
  const lista: DocumentoRichiesto[] = [];
  // Sempre: libretto
  lista.push({ tipo: 'LIBRETTO_CIRCOLAZIONE', parte: 'VEICOLO', ... });
  // Pre-2015: + CdP
  if (p.annoImmatricolazione && p.annoImmatricolazione < 2015) {
    lista.push({ tipo: 'CERTIFICATO_PROPRIETA', parte: 'VEICOLO', ... });
  }
  // Lato venditore: CI / CF / Visura / Permesso
  // (logica per branch)
  // Procura: CI procuratore + CI venditore + atto procura
  if (p.flagProcura) { ... }
  // Successione: certificato morte + atto eredità + dichiarazione + CI erede
  if (p.flagSuccessione) { ... }
  // Lato compratore: CI / CF / Visura / Permesso
  // Minore: + autorizzazione tutore + CI tutore
  if (p.flagMinore) { ... }

  return { kind: 'OK', documentiRichiesti: lista };
}
```

Test unitari: 1 caso per ogni branch (≥20 test).

---

## Wizard branching

`apps/piattaforma/src/app/pratiche/nuova/wizard.tsx` — refactor con step dinamici:

### Step proposti (dinamici)
1. **Veicolo** — libretto + targa + telaio + anno + comodato + fermo
2. **Venditore** — tipo soggetto + flags (procura, successione)
3. **Documenti venditore** — campo dinamico in base a step 2
4. **Compratore** — tipo soggetto + flag minore
5. **Documenti compratore** — campo dinamico in base a step 4
6. **Documenti procura** (solo se flagProcura)
7. **Documenti successione** (solo se flagSuccessione)
8. **Riepilogo + dichiarazione** (vedi sistema-penali-broker)

Pattern come `register-wizard.tsx`: state `step`, condizionali `if (step === N && ...)`.

### Validazione applicativa

Prima del submit finale:
1. `calcolaDocumentiRichiesti(praticaData)` server-side
2. Se `kind === 'BLOCCO'` → return error con `motivo` + `soluzione`
3. Se `kind === 'REVISIONE_MANUALE'` → mostra UI dedicata, set `richiedeRevisioneManuale=true`, salva come bozza, notifica admin
4. Se `kind === 'OK'` → controlla che ogni `DocumentoRichiesto.tipo` sia presente in `Pratica.documenti`. Se manca → error con lista mancanti.

---

## UI broker — Lista documenti mancanti

Quando il wizard riconosce documenti mancanti:

```
⚠️ Mancano alcuni documenti per inviare la pratica

Per il venditore (azienda):
• Visura camerale (rilasciata negli ultimi 6 mesi)  ← carica
• CI amministratore fronte                          ← carica
• CI amministratore retro                           ← carica

Per il compratore (straniero extra-UE):
• Permesso di soggiorno (in corso di validità)      ← carica

[Continua a caricare]    [Salva come bozza]
```

Ogni voce ha un upload diretto inline. Il bottone "Continua" rivaluta in real-time. Quando completo, mostra "Tutto pronto, conferma e invia".

---

## Caso non riconosciuto

Bottone "Non trovo la mia situazione" nel wizard, sempre visibile dopo step 2.

**Click** → modale:
```
La tua situazione non rientra in uno schema standard?

Salviamo la pratica come bozza e il nostro team la analizza
manualmente entro 24-48 ore. Ti contatteremo via email/SMS
con istruzioni precise sui documenti necessari.

Descrivi brevemente la tua situazione (max 500 char):
[textarea]

Tipo:
( ) Documento non standard (es. atto giudiziario)
( ) Caso non previsto dallo schema
( ) Altro

[Salva e richiedi revisione]    [Annulla]
```

Server action `richiediRevisioneManualeAction(praticaId, motivo, note)`:
- Aggiorna pratica: `richiedeRevisioneManuale=true`, `motivoRevisione`, `noteRevisione`
- Pratica resta `BOZZA`
- Notifica `N20_ADMIN_REVISIONE_RICHIESTA` agli admin platform

**Pagina admin `/admin/revisioni`:** lista pratiche con `richiedeRevisioneManuale=true`, bottoni "Risolto" (chiude flag, broker riprende il wizard) / "Annulla pratica".

---

## Notifiche nuove

| Tipo | Quando | Destinatario |
|---|---|---|
| `N20_ADMIN_REVISIONE_RICHIESTA` | Broker richiede revisione manuale | Admin platform |
| `N21_BROKER_REVISIONE_COMPLETATA` | Admin chiude la revisione | Broker |

---

## Ordine di implementazione

**Bundle SD-A — Schema + engine pure**
1. Migrazione campi `Pratica` + enum `TipoSoggetto` + nuovi `DocumentoTipo`
2. Engine `calcolaDocumentiRichiesti` in `packages/lib`
3. Test unitari (≥20 branch)

**Bundle SD-B — Wizard branching**
4. Refactor wizard `pratiche/nuova` in step dinamici
5. UI mancanti documenti con upload inline
6. Validazione server-side al submit

**Bundle SD-C — Revisione manuale**
7. Modale "Non trovo la mia situazione"
8. Pagina admin `/admin/revisioni`
9. N20 + N21 templates
10. Server action `risolviRevisioneAction`

**Bundle SD-D (futuro AI)**
11. Integrazione Google Document AI per estrazione automatica
12. Stato `INTEGRAZIONE_RICHIESTA` post-submit
13. Cross-check AI vs dichiarazione broker

---

## Punti aperti / B-LEGAL

- Documenti successione: lo schema cita 4 documenti — verifica con notaio se "Atto accettazione eredità" + "Dichiarazione qualità erede" sono entrambi necessari o ridondanti
- Procura notarile: forma minima accettata? PDF + firma digitale → ammesso?
- Visura ≤ 6 mesi: 6 mesi solari o 180 giorni esatti?
- Comodato d'uso: la "revoca PRA" è documento ufficiale? Forma standard?
- "Operatore auto" → MINI VOLTURA: serve attestazione iscrizione albo dealer?

> Tutte da validare con commercialista/legale in B-LEGAL prima del go-live.
