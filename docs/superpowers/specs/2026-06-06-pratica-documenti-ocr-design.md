# Pratica: banner + OCR libretto reale + blocco comodato + CdP condizionale + UI documenti a card — Design

**Data:** 2026-06-06
**Stato:** approvato (design)
**Branch:** feat/tipi-pratica-multiveicolo (continua il lavoro tipi-pratica)

## Goal
Portare lo step documenti della creazione pratica allo standard della registrazione: banner promemoria documenti fisici, OCR libretto reale (Google Document AI) per veicolo con **blocco rigido sul comodato d'uso**, campo **Certificato di Proprietà** condizionale (veicoli pre-2015), e **upload a card** guidate dai documenti richiesti dall'engine, **tutte obbligatorie**.

## Decisioni acquisite
1. Step documenti = **griglia di card** generata dai documenti richiesti dall'engine (sostituisce l'uploader per-parte). Il libretto resta nello step veicolo.
2. **Tutti** i documenti richiesti sono **obbligatori** (submit bloccato se mancano); libretto obbligatorio nello step veicolo.
3. Comodato rilevato da OCR → checkbox **read-only**, **nessun override**, blocco.
4. **DocCard condiviso** estratto da register-wizard in `components/doc-card.tsx`, riusato da registrazione + pratica.

## 1. Banner promemoria (step documenti)
Alert informativo fisso in cima allo step documenti: *"Ricorda: tutti i documenti richiesti vanno portati in originale, fisicamente in agenzia, al momento della firma."* Sempre visibile (non dismissibile).

## 2. Componente DocCard condiviso
Estrarre il componente `DocCard` (oggi dentro `apps/piattaforma/src/app/(auth)/register/register-wizard.tsx`) in `apps/piattaforma/src/components/doc-card.tsx` (props: `label`, `file`, `onChange`, `invalid?`, hint opzionale). Aggiornare la registrazione per importarlo da lì (nessun cambio di comportamento). Riusarlo nello step documenti pratica.

## 3. Step veicolo — blocco comodato (modifica `VeicoloSection`)
- L'OCR libretto (`extractLibrettoAction`) già ritorna `flagComodatoDuso`. Quando `true` da OCR:
  - Mostrare un **Alert error** prominente: *"Veicolo in comodato d'uso: è obbligatorio recarsi in agenzia per farlo revocare prima di procedere. Non è possibile creare la pratica con un veicolo in comodato."*
  - **Bloccare** l'avanzamento: il wizard non consente "Avanti"/submit finché esiste un veicolo con `flagComodatoDuso`.
  - Il checkbox "Comodato d'uso rilevato" diventa **read-only/disabled** quando impostato dall'OCR (no override).
- Percorso "inserimento manuale" (OCR fallito): il checkbox è settabile dall'utente; se spuntato → stesso Alert + blocco.
- Backstop: l'engine ritorna `BLOCCO` su comodato (già implementato) — la validazione server-side resta.

## 4. Step documenti — card guidate dai documenti richiesti
- Calcolare `esito = calcolaDocumentiRichiesti(...)` (già fatto per l'anteprima). Se `esito.kind === 'BLOCCO'` → mostrare il blocco (es. comodato/permesso/visura) e impedire l'invio. Se `OK`:
  - Per ogni `documentoRichiesto` con `tipo !== 'LIBRETTO_CIRCOLAZIONE'` (il libretto è nello step veicolo) renderizzare una **DocCard**.
  - **Chiave stabile** per documento: `docKey = `${tipo}__${parte}__${veicoloOrdine ?? 0}``. Label card = `motivo` (engine) o label derivata (es. "Certificato di Proprietà — Veicolo 2", "Carta d'identità fronte — Venditore").
  - Le card del CdP (`CERTIFICATO_PROPRIETA`, parte `VEICOLO`, con `veicoloOrdine`) compaiono solo per i veicoli pre-2015 → requisito (3)/(4) soddisfatto automaticamente dall'engine.
  - Stato wizard: `documenti: Record<docKey, File>`. Quando l'insieme dei documenti richiesti cambia (es. tipoSoggetto parte, pre-2015), scartare i file per chiavi non più richieste.
- **Obbligatorietà**: "Completa/Invia" disabilitato finché ogni `docKey` richiesto ha un file. Mostrare contatore "N/M documenti caricati".

## 5. Submit + action (`pratiche/nuova/actions.ts` + `wizard.tsx`)
- Il wizard invia, oltre ai dati esistenti, i file documenti come slot FormData `DOC__<docKey>`.
- L'action: ricalcola **server-side** `calcolaDocumentiRichiesti` dai dati submit; se `BLOCCO` → errore. Per ogni documento richiesto (escluso libretto): verifica presenza dello slot file; se manca → errore "Documenti mancanti". Carica su storage e crea `Documento` con:
  - `tipo` = documento richiesto, `praticaId`,
  - `veicoloId` per i documenti con `parte === 'VEICOLO'` e `veicoloOrdine` (mappa ordine→veicolo creato),
  - `owner` mappato da `parte` via helper: VENDITORE/AMMINISTRATORE_VENDITORE→`VENDITORE`; ACQUIRENTE/AMMINISTRATORE_ACQUIRENTE→`ACQUIRENTE`; VEICOLO→null (usa veicoloId); PROCURATORE/EREDE/TUTORE→null (metadati nel motivo; estensione enum fuori scope).
- Mantiene il gating rule-based esistente (classifier MIME/size) sui file caricati.

## 6. OCR reale (verifica, già attivo)
`extractLibrettoAction` usa `getOcr().extractLibretto` → provider unificato Google Document AI (in prod `OCR_PROVIDER=google_documentai`; locale `mock`). Verificare che il parser libretto (`lib/providers/ocr/libretto-parser.ts`) rilevi il comodato (`/COMODATO/`); rifinire se necessario (es. "COMODATO D'USO", "in comodato"). Nessun nuovo provider.

## Edge cases
- Documenti richiesti dinamici: cambiano con tipoSoggetto parti + pre-2015 veicoli; le card si rigenerano; i file orfani (chiavi non più richieste) vengono scartati prima del submit.
- Comodato su uno qualsiasi degli n veicoli → blocco totale.
- CdP per più veicoli pre-2015 → una card CdP per veicolo (chiave include veicoloOrdine).
- Manuale (OCR fallito): nessun dato comodato auto → utente dichiara; CdP via checkbox pre-2015 manuale.

## Testing
- `lib/documenti/engine` già copre CdP/comodato per-veicolo.
- Nuovi/aggiornati: helper `parteToOwner` (unit); funzione che deriva le `docKey` richieste dall'esito engine (unit); validazione server-side "documenti mancanti" nell'action (se testabile a unità) o via fixture.
- E2E (post-deploy, chrome-devtools): libretto con comodato → blocco; veicolo pre-2015 → card CdP compare; submit bloccato se manca un documento.

## Fuori scope
- Estensione enum `DocumentoOwner` per PROCURATORE/EREDE/TUTORE (owner null per ora).
- Cambi al motore di distribuzione.

## Sequenza
DocCard condiviso → banner → blocco comodato (VeicoloSection) → step documenti a card (derivazione docKey + obbligatorietà) → action (validazione + persistenza per chiave) → verifica parser comodato → test.
