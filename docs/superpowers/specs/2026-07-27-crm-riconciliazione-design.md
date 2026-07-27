# Riconciliazione CRM ↔ aziende registrate — design

Data: 2026-07-27
Branch: `feat/crm-riconciliazione`

## Obiettivo

Riconoscere quali righe della lista CRM importata corrispondono ad aziende (e sedi)
già registrate sulla piattaforma, agganciarle e portarne lo stato al punto reale del
funnel. Effetto atteso in area admin: i contatori "Iscritti/Attivi" smettono di essere
zero e le righe della lista cambiano stato quando l'utenza è già a bordo.

## Perché l'algoritmo attuale non aggancia niente

Misurato sul DB locale (copia prod, 19.103 contatti, 19 company, 22 sedi,
**0 contatti agganciati**):

1. **Il match telefonico non può scattare.** `tryMatchCrmContact` normalizza il telefono
   della Company e lo confronta con `CrmContact.tel` **grezzo**
   (`lib/crm/sync.ts:77`). In lista i numeri sono scritti `+39 02 447 8712`:
   l'uguaglianza non è mai vera se non per caso.
2. **Esistono due `normalizePhone` divergenti**: `lib/crm/util.ts` (toglie solo spazi e
   `+39`, ed è quella usata dal match) e `lib/crm/phone.ts` (sole cifre, gestisce `0039`).
3. **La cascade email → tel → P.IVA è tarata su dati che la lista non ha**:

   | campo | valorizzati su 19.103 |
   |---|---|
   | tel | 19.103 (100%) |
   | CAP / indirizzo / città | 19.100 / 19.075 / 18.408 |
   | email | 244 (1,3%) |
   | P.IVA | 0 |

4. **Il match non è mai retroattivo**: gira solo dentro la registrazione. Chi si è
   registrato prima dell'import non viene mai riesaminato.
5. **Le sedi non entrano nel confronto**, benché la lista sia fatta di punti vendita.

Caso reale verificato sul DB: `AGENZIA CORSICO DI CIAVARELLA ANTONIO` (registrata,
`024478712`, Via Fiume, Corsico) è in lista come `Agenzia Corsico Pratiche Auto`
(`+39 02 447 8712`, Via Fiume 6, Corsico) — stessa azienda, nome diverso, oggi non
agganciata.

Vincolo che il design deve reggere: **il 30% della lista (5.720 righe su 19.084)
condivide il telefono con un'altra riga** — duplicati di scraping, centralini di gruppo,
numeri verdi.

## Decisioni

| # | Decisione | Scelta |
|---|---|---|
| D1 | Cosa vale come prova d'identità | Solo identificativi forti (P.IVA, email, PEC, telefono, WhatsApp). Nome, indirizzo, città, CAP sono punteggio e spareggio, mai prova autonoma |
| D2 | Concorrenza fra più righe sulla stessa identità (madre o singola sede) | Si aggancia **solo la riga migliore**; le altre restano lead attivi. Vale per identità, non per azienda: sedi diverse agganciano righe diverse (vedi D3) |
| D3 | Sedi | Ogni sede è un'identità a sé: un'azienda con 3 sedi può agganciare fino a 4 righe (madre + 3), tutte con `companyId` = madre e `sedeId` valorizzato |
| D4 | Stato dei contatti agganciati retroattivamente | Allineato allo storico: S7 registrata, S8 ≥1 firmata, S9 ricorrente |
| D5 | Esecuzione | Pagina admin con anteprima e conferma + passata automatica nel cron `crm-sync` |

## Architettura

Un solo motore, tre chiamanti. Moduli nuovi sotto `apps/piattaforma/src/lib/crm/match/`:

```
normalize.ts   puro   normalizzazione dei campi (fonte unica)
identita.ts    puro   Company + Sedi → identità confrontabili
score.ts       puro   (identità, contatto) → { ammesso, punteggio, campi }
engine.ts      server candidati dal DB + assegnazione senza conflitti
apply.ts       server scrive l'aggancio e allinea lo stato
```

`normalize.ts` sostituisce **entrambe** le funzioni esistenti: `lib/crm/util.ts` perde
`normalizePhone` e `lib/crm/phone.ts` viene assorbito, così non restano copie divergenti.

### normalize.ts

- `normalizeTel(raw)` → sole cifre; `0039…` → taglia 4; `39…` con più di 10 cifre →
  taglia 2 (protegge i cellulari `39x` a 10 cifre). Chiave valida solo con **≥ 8 cifre**
  (le 19 righe `N/D` decadono da sole).
  `+39 02 447 8712` = `024478712` = `0039 02 4478712` → `024478712`.
- `normalizeEmail(raw)` → trim + lowercase.
- `normalizePiva(raw)` → sole cifre, valida solo a 11.
- `normalizeNome(raw)` → lowercase, accenti sciolti, forme societarie rimosse
  (`srl`, `s.r.l.`, `srls`, `spa`, `s.p.a.`, `snc`, `sas`, `sc`, `soc. coop.`),
  punteggiatura via, spazi compattati.
- `normalizeIndirizzo(raw)` → lowercase, accenti e punteggiatura via, abbreviazioni
  sciolte (`v.le`→`viale`, `p.zza`→`piazza`, `c.so`→`corso`, `v.`→`via`), **civico finale
  rimosso** → `Via Fiume` e `Via Fiume 6` danno la stessa chiave.
- `normalizeCitta(raw)`, `normalizeCap(raw)` → lowercase/trim, CAP a 5 cifre.

### identita.ts

Da una Company con le sue sedi non cancellate produce N+1 identità:

```ts
type Identita = {
  companyId: string;
  sedeId: string | null;      // null = madre
  cat: 'BROKER' | 'AGENZIA';  // DEALER→BROKER, AGENZIA→AGENZIA
  telKeys: string[];          // telefono madre o sede
  emailKeys: string[];        // email + PEC
  pivaKeys: string[];         // P.IVA madre (le sedi la ereditano)
  nomeKeys: string[];         // sede: nome sede + ragione sociale madre
  indirizzoKey, cittaKey, capKey: string | null;
  registrataAt: Date;         // createdAt della company o della sede
};
```

Le sedi ereditano la P.IVA della madre: oggi la lista non ha P.IVA, ma gli import futuri
sì e la regola resta corretta.

### score.ts — ammissione e punteggio

Chiavi del contatto: telefono = `{tel, wa}` normalizzati; email = `{email}`;
P.IVA = `{piva}`. Un campo è in comune se le due liste si intersecano.

**Ammissione**: serve almeno una prova forte (P.IVA, email/PEC, telefono/WhatsApp).
**Eccezione categoria**: se `Contact.cat` non corrisponde al tipo dell'azienda
(BROKER↔DEALER, AGENZIA↔AGENZIA), la prova forte da sola **non basta** — serve un
secondo campo in comune, forte o debole. È la protezione contro i centralini di gruppo
condivisi da attività di natura diversa.

**Punteggio** (somma dei campi in comune):

| campo | peso |
|---|---|
| P.IVA | 100 |
| email o PEC | 60 |
| telefono o WhatsApp | 50 |
| nome identico | 25 |
| nome contenuto nell'altro (parole intere) | 15 |
| indirizzo | 20 |
| CAP | 5 |
| città | 5 |

Il punteggio serve solo a ordinare: "più campi uguali vince".

### engine.ts — assegnazione senza conflitti

1. Carica i contatti **candidati**: `deletedAt: null`, `companyId: null`, con almeno una
   chiave forte valorizzata. Select minimale (chiavi normalizzate + deboli + `createdAt`
   + `status`): 19k righe stanno in memoria senza problemi.
2. Indicizza i candidati in `Map<chiave, contactId[]>` per telefono, email, P.IVA.
3. Per ogni identità, recupera i candidati dalle mappe (nessun prodotto cartesiano),
   valuta ammissione e punteggio → coppie `(identità, contatto, punteggio, campi)`.
4. **Assegnazione greedy globale**, ordine `punteggio desc → contatto.createdAt asc →
   contactId asc` (deterministica): assegna la coppia se il contatto è ancora libero **e**
   l'identità non ha già preso un contatto. Così un contatto va a una sola azienda e
   un'identità a un solo contatto (D2).
5. Identità già coperte (esiste un contatto con quel `companyId` + `sedeId`) sono escluse:
   il motore è idempotente e le passate successive lavorano solo sul residuo.

Aziende e sedi cancellate sono escluse; quelle sospese no (restano registrate, il loro
stato piattaforma lo racconta `platStatus`).

### apply.ts — effetti dell'aggancio

Per ogni proposta accettata:

- `companyId`, `sedeId`, `matchVia` (es. `tel+indirizzo`), `matchedAt`
- `iscrizioneComp: true`, `iscrizioneAt` = data reale di registrazione (`registrataAt`)
- `status` allineato allo storico dell'azienda (D4): 0 firmate → **S7**, 1 → **S8**,
  ≥2 → **S9**. **Solo in salita**: uno stato già più avanti non retrocede e **S10
  (churned) non si tocca mai**.
- `primaPratica` / `primaPraticaAt` dalla prima pratica firmata
- `platStatus` calcolato come nel cron (SOSPESO se sospesa/cancellata, ATTIVO se ha
  firmato, altrimenti INATTIVO)
- `fonte` resta com'è (lo storico del lead, `CSV_INIZIALE`, non si perde) con la
  sola eccezione già viva oggi: se la Company è arrivata da un referral
  (`referenteId` valorizzato) la fonte diventa `REFERRAL`

Il conteggio pratiche segue il tipo di azienda: `brokerId` per i DEALER,
`agenziaAssegnataId` per le AGENZIA (vedi difetti collaterali).

## Modello dati

Migration **scritta a mano** e applicata con `db:deploy` (`prisma migrate dev` propone
DROP distruttivi su questo schema).

Su `crm_contacts`:

| colonna | tipo | note |
|---|---|---|
| `telNorm` | `text?` | indicizzata |
| `waNorm` | `text?` | indicizzata |
| `emailNorm` | `text?` | indicizzata |
| `pivaNorm` | `text?` | indicizzata |
| `sedeId` | `uuid?` | FK → `sedi(id)` `ON DELETE SET NULL`, indicizzata |
| `matchVia` | `text?` | prova che ha generato l'aggancio |
| `matchedAt` | `timestamp?` | quando è stato agganciato |

Backfill delle quattro colonne normalizzate nella stessa migration (`regexp_replace`
con la stessa logica di `normalizeTel`/`normalizeEmail`/`normalizePiva`).

**Mantenimento**: un helper unico `crmNormFields(input)` produce le quattro colonne e
viene usato da **tutti** i write path che toccano tel/wa/email/piva — import CSV bulk,
`createCrmContactAction`, `updateCrmContactAction`. Senza questo le colonne si
desincronizzano in silenzio e il match torna a fallire come oggi.

## Punti di integrazione

1. **Registrazione** (`(auth)/actions.ts:727`): `tryMatchCrmContact(companyId)` continua a
   esistere ma delega al motore nuovo, limitato a quella company. Resta best-effort e non
   fa fallire la registrazione.
2. **Cron `crm-sync`** (`api/jobs/crm-sync/route.ts`): prima la passata di riconciliazione,
   poi l'aggiornamento aggregati già esistente.
3. **Pagina admin** `/admin/crm/riconciliazione`, riservata al CRM full
   (`ADMIN_PIATTAFORMA`, `AD`, `CTO`) tramite un nuovo `canRunCrmReconciliation` —
   vista **e** applicazione: è un'operazione di massa, fuori portata di SALES e
   SALES_MANAGER:
   - anteprima in sola lettura: contatto (nome, tel, città) ↔ azienda/sede, chip dei campi
     in comune, punteggio;
   - riepilogo "N righe verranno agganciate, di cui X broker e Y agenzie";
   - bottone «Applica» (server action) che esegue e mostra l'esito.
   L'anteprima non scrive nulla: è lo stesso motore in modalità dry-run.
4. **Lista contatti**: la riga agganciata mostra un badge con l'azienda (e la sede) a cui
   è legata. Oggi `companyId`/`iscrizioneComp` compaiono solo nel form di modifica.

## Difetti collaterali che rientrano nello scopo

- `syncCrmFromPlatform` conta le pratiche **solo** per `brokerId`: ogni agenzia agganciata
  resterebbe a 0 pratiche e `INATTIVO` per sempre, e le agenzie sono 7.880 righe della
  lista. Si aggiunge il ramo `agenziaAssegnataId` scelto in base a `Company.type`.
- `createCrmContactAction` carica tutti i contatti per il dedup telefono/email: con le
  colonne normalizzate diventa una query indicizzata.

## Verifica

- Unit sui normalizzatori: prefissi `+39`/`0039`/nessuno, spazi e punteggiatura, cellulari
  `39x` a 10 cifre (non devono perdere il `39`), `N/D`, CAP e civici.
- Unit sullo scoring: prova forte sola ammessa; categoria discorde respinta senza secondo
  indizio; ordinamento per punteggio; spareggio sul contatto più vecchio.
- Unit sull'assegnazione: contatto conteso da due identità → una sola vince; identità con
  due contatti ammissibili → prende il migliore; seconda passata idempotente.
- Caso reale Corsico come fixture, più il caso "stesso centralino, filiali diverse".
- **Dry-run sul DB locale reale** (19.103 contatti) prima di dichiarare finito: numero di
  match proposti, ispezione manuale delle prime righe, verifica che non compaiano
  accoppiamenti assurdi.
- Verifica browser della pagina admin e del badge in lista.

## Fuori scope

- Deduplicare la lista CRM al suo interno (le 5.720 righe con telefono condiviso).
- Fuzzy matching sui nomi oltre l'uguaglianza/contenimento normalizzato.
- Sganciare o correggere un match dall'interfaccia (`matchVia`/`matchedAt` lasciano la
  porta aperta, ma l'azione non fa parte di questo lavoro).
- Arricchire i contatti con i dati della piattaforma (P.IVA, email) dopo l'aggancio.

## Rischi

- **Migration in parallelo**: un'altra sessione lavora sullo stesso repo. Il lavoro sta su
  `feat/crm-riconciliazione`; prima del merge va verificato che non esistano due migration
  concorrenti sullo stesso schema.
- **Falsi positivi da centralino**: mitigati da D2 (una sola riga per identità) e
  dall'eccezione categoria, non azzerati. L'anteprima esiste per questo.
- **Colonne normalizzate disallineate** se un write path futuro dimentica l'helper: da
  presidiare con un test che verifica la scrittura delle colonne su create e update.
