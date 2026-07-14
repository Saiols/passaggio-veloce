# Copertura GDPR dei dati di venditore e acquirente (soggetti terzi)

**Data:** 2026-07-14
**Stato:** design approvato, da implementare
**Natura:** DRAFT tecnico — come `/termini` e `/privacy`, **da sottoporre a revisione legale prima del go-live**

---

## 1. Il problema

Venditore e acquirente non hanno alcun rapporto contrattuale con Passaggio Veloce. Sono
clienti del broker. Eppure oggi PV:

- riceve i loro **documenti d'identità** (`CI_FRONTE`, `CI_RETRO`, `PATENTE`, `PASSAPORTO`,
  `CODICE_FISCALE`, `PERMESSO_SOGGIORNO`, `CERTIFICATO_MORTE`);
- li dà in pasto a **Google Document AI** per l'OCR e ne conserva l'estratto in chiaro
  (`Documento.ocrData`, `SegnalazioneCreazione.datiSnapshot`);
- **scrive loro email dirette** col proprio brand da `noreply@passaggioveloce.it`
  (`N40_CLIENTE_AVANZAMENTO`, 6 call-site, nessun opt-out);
- decide **retention**, **antifrode**, **assegnazione** della pratica all'agenzia.

E non ha mai dato loro un'informativa. Le parole «titolare del trattamento», «responsabile
del trattamento», «art. 28» **non compaiono** in `/termini`. La `/privacy` non ha una riga
sui terzi.

### Perché la strada del "DPA / responsabile ex art. 28" è sbagliata

L'ipotesi iniziale (PV = responsabile che tratta *su istruzione* del broker, coperto da un
DPA) descrive un fornitore passivo. Non è quello che facciamo: scegliere il provider OCR,
scrivere email ai clienti finali di propria iniziativa, fissare la retention, sanzionare il
broker col sistema penali sono **finalità e mezzi determinati da PV**, non istruzioni del
broker. Un responsabile che commina penali al proprio titolare è una contraddizione.

L'**art. 28(10) GDPR** è esplicito: il responsabile che determina finalità e mezzi *è
considerato titolare* per quel trattamento. Un DPA che ci qualifica come responsabili mentre
ci comportiamo da titolari non protegge: ci rende titolari **di fatto**, sprovvisti di
informativa. È il peggiore dei due mondi.

### Perché "consenso" è la parola sbagliata

Il consenso è **revocabile**. Se il venditore lo revoca a metà pratica il passaggio di
proprietà si blocca. E comunque non è la base che stiamo usando. Quello che il broker deve
garantirci non è «ho il consenso», è **«ho informato i miei clienti»**.

---

## 2. Decisione: PV titolare autonomo

| Soggetto | Ruolo |
|---|---|
| Broker / agenzia | **Titolare** verso il proprio cliente: lo ha in negozio, raccoglie lui i documenti |
| Passaggio Veloce | **Titolare autonomo** a valle, per finalità proprie |

Il flusso broker → PV è una **comunicazione tra titolari autonomi**, non un conferimento a
un responsabile. Nessun DPA: al suo posto, una **garanzia con manleva** nei Termini.

**Basi giuridiche di PV verso venditore/acquirente:**

- **art. 6.1.f** (legittimo interesse) — erogare il servizio di intermediazione richiesto al
  broker, prevenire le frodi sui passaggi di proprietà;
- **art. 6.1.c** (obbligo legale) — conservazione fiscale, adempimenti PRA.

Deliberatamente **non** l'art. 6.1.b: il contratto è col broker, non con l'interessato.
Deliberatamente **non** il consenso (v. sopra).

Poiché la base è il legittimo interesse, l'interessato ha **diritto di opposizione**
(art. 21): va dichiarato nell'informativa.

> **Punto per il legale.** La qualificazione è la scelta portante. Le alternative erano
> contitolarità (art. 26 — responsabilità solidale, il cliente può rivalersi su di noi per
> errori del broker) e responsabile (art. 28 — v. §1). Se il legale sceglie diversamente,
> cambiano la clausola 17 e l'intestazione dell'informativa; **l'impianto tecnico resta**.

---

## 3. Termini: nuova clausola 17

Inserita **dopo la 16** (Trattamento dei dati personali), in
`apps/piattaforma/src/app/termini/page.tsx`.

**Clausola 17 — Dati di venditori, acquirenti e altri terzi**

- **17.1 Ruoli.** L'Utente è titolare del trattamento verso i propri clienti; PV tratta i
  dati come **titolare autonomo** per le proprie finalità. PV **non** agisce come
  responsabile ex art. 28.
- **17.2 Garanzia.** Caricando dati di terzi, l'Utente garantisce di aver reso loro
  l'informativa ex art. 13 e di averli informati che i dati sono comunicati a PV per la
  gestione della pratica.
- **17.3 Informativa diretta.** PV rende comunque ai terzi la propria informativa ex art. 14,
  anche tramite le comunicazioni email sull'avanzamento della pratica.
- **17.4 Minimizzazione.** L'Utente non carica dati o documenti non necessari alla pratica.
- **17.5 Manleva.** L'Utente tiene indenne PV da pretese, reclami e sanzioni derivanti dalla
  violazione delle garanzie che precedono.
- **17.6 Violazioni dei dati.** Obbligo reciproco di informarsi senza ritardo in caso di
  data breach.

### Conseguenze meccaniche (il campo minato)

La 17.5 è una **manleva** → clausola **vessatoria**, stessa natura della manleva sulla visura
(clausola 8), già nell'elenco.

In `apps/piattaforma/src/lib/legal/clausole-vessatorie.ts` (fonte unica):

| Costante | Prima | Dopo |
|---|---|---|
| `ART_APPROVAZIONE_SPECIFICA` | `18` | `19` |
| `CLAUSOLE_VESSATORIE` | `[3,5,7,8,10,11,12,13,17]` | `[3,5,7,8,10,11,12,13,17,18]` |
| `DESCRIZIONI_VESSATORIE[17]` | `deroga alla competenza territoriale` | `garanzia e manleva sui dati di venditori e acquirenti` |
| `DESCRIZIONI_VESSATORIE[18]` | — | `deroga alla competenza territoriale (foro esclusivo)` |
| `TERMS_VERSION` | `2026-07-13` | `2026-07-14` |

Rinumerazione delle Section in `termini/page.tsx`: `17. Legge applicabile e foro` → **18**,
`18. Approvazione specifica` → **19**. Il commento JSDoc di testa (riga 26, «elencate alla
clausola 18») va aggiornato a mano: è un commento, non interpola.

**Verificato:** gli unici rimandi interni nel testo puntano alle clausole **10, 11, 12, 14**
— tutte sotto la 16, quindi **intatte**. I nove `v. clausola 18` sono già interpolazioni di
`ART_APPROVAZIONE_SPECIFICA` e si aggiornano da soli. Fuori da `termini/page.tsx`, i
riferimenti in codice/docs/test citano solo clausole ≤ 12 (penali 10.x, sospensione 12.x,
firma 11): nessuno tocca la fascia rinumerata.

**Clausola 16** ritoccata: rinvia a **entrambe** le informative (`/privacy` per gli utenti
registrati, `/privacy/clienti` per i clienti finali).

---

## 4. Nuova pagina `/privacy/clienti` — informativa art. 14

Nuovo file `apps/piattaforma/src/app/privacy/clienti/page.tsx`.

La `/privacy` esistente è scritta per il broker: parla di IBAN, Stripe, regime fiscale, KYC
del legale rappresentante. Un venditore non ci si riconosce, e soprattutto non ci trova ciò
che l'art. 14 impone **proprio nel suo caso**.

Linguaggio piano, rivolto a una persona che non ha mai sentito nominare PV e si vede
arrivare una mail. Contenuti:

1. **Chi siamo** — PV S.r.l., `privacy@passaggioveloce.it`.
2. **Da dove abbiamo i tuoi dati** — ce li ha trasmessi il concessionario/agenzia a cui ti
   sei rivolto. *È il cuore dell'art. 14 e ciò che distingue questa informativa dalla
   `/privacy`.*
3. **Quali dati** — anagrafica, documento d'identità, codice fiscale, dati del veicolo; e i
   documenti particolari quando la pratica lo richiede (**permesso di soggiorno**,
   **certificato di morte** nelle successioni).
4. **Perché e su quale base** — erogazione della pratica e antifrode (art. 6.1.f), obblighi
   fiscali (art. 6.1.c).
5. **A chi li comunichiamo** — **l'agenzia che lavora la pratica** (altro titolare: va detto),
   più i fornitori tecnici: Google Document AI (OCR), Resend (email), Vercel (hosting e
   storage documenti), Neon (database).
6. **Per quanto li teniamo** — coerente con la retention reale (v. §6).
7. **I tuoi diritti** — artt. 15-22, incluso il **diritto di opposizione** (base = legittimo
   interesse), e reclamo al Garante.

---

## 5. Email N40: l'informativa deve *arrivargli*

L'art. 14 vuole l'informativa **al più tardi alla prima comunicazione** all'interessato.
Quella comunicazione già la facciamo: `N40_CLIENTE_AVANZAMENTO`, variante `AVVIATA`, inviata
al submit della pratica. È il veicolo naturale.

- **Tutte e 5 le varianti** (`AVVIATA`, `PRESA_IN_CARICO`, `PRONTA_FIRMA`, `COMPLETATA`,
  `ANNULLATA`): link a `/privacy/clienti` nel footer.
- **Variante `AVVIATA`**: paragrafo esplicito — «i tuoi dati ci sono stati trasmessi da
  *«nome broker»* per gestire il passaggio di proprietà; qui trovi chi siamo e come li
  trattiamo».

**Codice:** il payload N40 (`lib/notifiche/templates.ts:126-139`) ha `agenziaNome` ma **non**
il broker. Serve:

- `nomeBroker?: string | null` in `N40ClienteAvanzamentoPayload`;
- `select` della company creatrice della pratica in `lib/notifiche/cliente.ts` (oggi
  seleziona solo `agenziaAssegnata` e `agenziaSede`);
- testo nei rami di `tplN40ClienteAvanzamento()` (`templates.ts:580`).

---

## 6. `/privacy`: rendere vero ciò che è falso

`apps/piattaforma/src/app/privacy/page.tsx` — tre correzioni di solo testo:

1. **Storage.** Dichiara **Cloudflare R2**. Il codice usa **Vercel Blob**
   (`lib/providers/storage/vercel-blob.ts`; R2 non esiste nel repo). Oggi la nostra privacy
   policy **dice il falso su dove stanno le carte d'identità**. → Vercel Blob.
2. **Categorie non dichiarate.** `PERMESSO_SOGGIORNO` e `CERTIFICATO_MORTE` vanno elencati,
   con la relativa base giuridica.
3. **Retention.** Promette «10 anni fiscali» per le pratiche, ma **nessun job** cancella le
   pratiche concluse. Riscrivere descrivendo ciò che il codice fa davvero: hard-delete
   documenti soft-deleted a **90 giorni** (`DOC_HARD_DELETE_DAYS`), purge bozze a **30**
   (`BOZZA_PURGE_DAYS`), pratiche concluse conservate per obbligo fiscale. Nessuna promessa
   di cancellazioni che non avvengono.

Più il rinvio a `/privacy/clienti`.

**Nessuna checkbox di consenso privacy separata in registrazione.** L'informativa si prende
in visione, non si consente; le basi sono contratto e obbligo di legge. Una spunta
«acconsento» suggerirebbe una base revocabile che non abbiamo: sarebbe **peggiorativa**.

---

## 7. La prova per singola pratica

`apps/piattaforma/src/components/dichiarazione-popup.tsx` → modello `BrokerDichiarazione`
(registra `praticaId`, `userId`, `ip`, `userAgent`, `popupVersion`).

Il broker già dichiara, a ogni invio, di aver verificato fermi/ipoteche/autenticità. Si
aggiunge una riga:

> «Dichiaro di aver informato venditore e acquirente che i loro dati sono trasmessi a
> Passaggio Veloce per la gestione della pratica.»

Bump di `popupVersion` (`lib/penali/config.ts`, oggi `v2.0`).

Costa una stringa, e ci dà la garanzia resa **nel momento esatto in cui i dati dei terzi ci
vengono conferiti**, con prova per-pratica (IP, user-agent, versione) invece di una spunta
unica presa in registrazione mesi prima. È il pezzo che rende la manleva della 17.5
**azionabile**.

---

## 8. Verifica

- `clausole-vessatorie.test.ts` blinda già l'invariante elenco↔descrizioni: se sbaglio la
  rinumerazione **diventa rosso**. Estenderlo alle due nuove voci.
- Grep di controllo: nessun `clausola 17` letterale residuo in `termini/page.tsx`.
- Test template N40: **tutte e 5** le varianti contengono il link a `/privacy/clienti`; la
  variante `AVVIATA` nomina il broker.
- **Rigenerare la KB del chatbot** (`lib/providers/chatbot/kb/kb.generated.ts`, generata dai
  docs al prebuild): cita numeri di clausola. Se non la rigenero, il bot risponderà con la
  numerazione vecchia — è esattamente il meccanismo con cui contratto e codice si sono già
  falsificati a vicenda.
- Verifica nel browser: `/termini`, `/privacy`, `/privacy/clienti` renderizzano; la
  registrazione mostra i numeri di clausola corretti (`3, 5, 7, 8, 10, 11, 12, 13, 17, 18`).

---

## 9. Fuori scope (dichiarato)

- Job di cancellazione delle pratiche concluse a scadenza fiscale (10 anni: nessuna urgenza
  tecnica; il testo della privacy viene reso veritiero senza il job).
- DPIA e registro dei trattamenti (art. 30) — documenti, non codice.
- Raccolta dei contratti di nomina a responsabile verso Google / Resend / Vercel / Neon
  (esistono come contratti standard, vanno solo archiviati).
- Riaccettazione retroattiva dei già registrati: **non serve** — non siamo ancora online, i
  dati attuali sono di test e il DB verrà ripulito.
- **La qualificazione definitiva**: decisione del legale (v. §2).
