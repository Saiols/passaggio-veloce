# Debito residuo del rilascio "fattura dopo l'incasso"

**Data:** 2026-07-26
**Stato:** approvato, da pianificare
**Segue:** `2026-07-26-fattura-dopo-incasso-design.md` (in prod dal 2026-07-26, commit `07f246f..e0148f7`)

## Problema

Il rilascio che ha spostato l'emissione della `FATTURA_PV` al momento dell'incasso
ha lasciato tre debiti, tutti tracciati nelle review ma non chiusi. Diventano
veri il giorno in cui `PAYMENT_PROVIDER` passa a `stripe`: farli prima costa
meno che scoprirli dopo.

1. **L'unicità della fattura per pratica non è garantita dal DB.**
   `createFatturaPv` la protegge con `findFirst` + `create` nella stessa
   transazione, ma a READ COMMITTED due transazioni concorrenti leggono
   entrambe `null` e creano entrambe. Lo `@@unique([emittenteCompanyId, anno,
   numeroProgressivo, tipo])` **non vincola le `FATTURA_PV`**: per loro
   `emittenteCompanyId` è `null`, e in Postgres i NULL sono distinti. La
   riconciliazione oraria bypassa per costruzione il compare-and-set di
   `segnaFeeIncassato` — riparte da fee già `SUCCESS` — quindi per lei
   l'idempotenza di `createFatturaPv` non è la seconda rete, è l'unica.
   Mitigata da una finestra di grazia di 5 minuti, non garantita.

2. **Nessun percorso porta un documento da `IN_ATTESA` a `PAGATA`.**
   `statoPagamento` è scritto solo alla `create` e dallo storno. In modalità
   live `createFatturaPv` crea già `PAGATA`, quindi gli unici documenti
   `IN_ATTESA` che esisteranno mai sono quelli nati dalla valvola nell'era
   mock: al passaggio a `stripe` verrebbero incassati davvero e resterebbero
   marcati "non pagata". Dato fiscale falso a video.

3. **I testi descrivono ancora la sequenza vecchia.**
   `docs/sistema-fatturazione.md` §1.2-1.3 mette la generazione fattura allo
   step 2 e l'addebito allo step 4. Quel file entra nella KB del chatbot: lo
   script `apps/piattaforma/scripts/build-chatbot-kb.ts` legge **ogni** `.md`
   di `docs/` (non ricorsivo, quindi `docs/superpowers/**` resta fuori), quindi
   è già adesso quello che il chatbot racconta alle agenzie. I Termini art. 11
   elencano fra gli effetti dell'attestazione «addebito della fee a carico
   dell'Agenzia ed emissione della relativa fattura», come se fossero
   contestuali.

## 1. Vincolo di unicità

`@@unique([praticaId, tipo])` su `DocumentoFiscale`.

**Perché non un indice parziale** (`... ON documenti_fiscali (praticaId) WHERE
tipo = 'FATTURA_PV'`), che vincolerebbe esattamente e solo ciò che serve:
Prisma non lo rappresenta in `schema.prisma`, quindi vivrebbe solo in SQL
grezzo e il prossimo `prisma migrate dev` lo leggerebbe come deriva da
eliminare — in un repo dove quel comando propone già DROP distruttivi. Nessun
indice parziale esiste oggi nel progetto: questo sarebbe il primo, e la deriva
non varrebbe la precisione in più.

**Cosa vincola davvero:** un documento per tipo per pratica. Regge oggi:
`createNotaCredito` rifiuta le note sulle note, e una seconda
`NOTA_VARIAZIONE` sulla stessa pratica richiederebbe un secondo originale —
cioè proprio ciò che stiamo impedendo. I `DOC_BROKER` hanno `praticaId` nullo
(sono agganciati al payout) e restano liberi, perché in Postgres i NULL sono
distinti.

**Il vincolo da solo peggiora le cose.** Oggi chi perde la corsa crea un
secondo documento; con l'indice esploderebbe con un `P2002` che risalirebbe al
chiamante. `createFatturaPv` deve catturare il `P2002` **su quel vincolo** e
tradurlo in `null` — che è già la sua semantica per "esisteva di già". Il
perdente smette di creare e comincia a comportarsi come chi arriva secondo.
Il `catch` va stretto sul codice e sul target: inghiottire ogni `P2002`
nasconderebbe anche la collisione sul `numeroDocumentoStr`, che è un'altra
cosa e non deve passare in silenzio.

Effetto collaterale buono: `prossimoContatore` incrementa dentro la stessa
transazione, quindi il rollback del perdente riporta indietro il contatore da
solo. Nessun buco di numerazione.

**Prima di applicare in produzione** va verificato che non esistano già
duplicati: la `CREATE UNIQUE INDEX` fallirebbe sui dati esistenti. Query di
controllo, non un `SELECT 1` di cortesia — deve restituire le pratiche con più
di una `FATTURA_PV`.

## 2. Transizione `IN_ATTESA` → `PAGATA`

In `segnaFeeIncassato`, subito dopo la chiamata a `createFatturaPv`:

```
updateMany({ where: { praticaId, tipo: 'FATTURA_PV', statoPagamento: 'IN_ATTESA' },
             data:  { statoPagamento: 'PAGATA' } })
```

Serve `praticaId` nella `select` del fee, che oggi prende solo `agenziaId`.

È idempotente: se il documento è appena nato è già `PAGATA` e la `updateMany`
non tocca nulla; se veniva dalla valvola lo allinea. Best-effort con
`console.error`, come il resto della funzione.

**Nessuna N53.** Il documento della valvola ha già viaggiato allegato alla N8 e
ha `inviatoEmailAt` valorizzato: rimandarlo sarebbe una seconda consegna della
stessa fattura.

**Fuori scope: la riconciliazione non copre questa transizione.** Il suo ramo 1
scarta le pratiche che hanno già una `FATTURA_PV`, quindi non vedrebbe i
documenti da allineare. Aggiungere una terza query sarebbe macchina in più per
una popolazione transitoria — i documenti `IN_ATTESA` esistono solo finché il
provider è `mock`. Se il percorso d'incasso manca l'allineamento, resta
manuale.

## 3. Testi

**`docs/sistema-fatturazione.md`** — le tabelle §1.2 (trapasso netto) e §1.3
(minivoltura) vanno riordinate: l'addebito precede la generazione della
fattura, e la fattura nasce a incasso confermato. Vanno cercate le altre
occorrenze della vecchia sequenza nello stesso file, non solo le due tabelle.
È la modifica che ha effetto immediato: il chatbot smette di descrivere un
flusso che non esiste più.

**Termini, art. 11** — «L'attestazione produce tutti gli effetti della
segnalazione ordinaria: perfezionamento della pratica, maturazione del compenso
del Broker, addebito della fee a carico dell'Agenzia ed emissione della
relativa fattura.» Va reso esplicito che la fattura segue l'incasso, non
l'attestazione.

**Termini, art. 9** — «secondo le tempistiche indicate in Piattaforma» regge
già così, ma vale la pena dire che l'addebito è contestuale alla firma, dato
che da questo rilascio lo è davvero.

**Guardia sugli spazi.** `apps/piattaforma/src/app/termini/spazi-jsx.test.ts`
esiste già, nato dalle 21 parole incollate fra loro: va esteso al testo nuovo.
La verifica finale si fa **leggendo il DOM renderizzato**, non i byte del
sorgente — il JSX mangia gli spazi a fine riga e il sorgente non lo mostra.
Mai `prettier` sulle pagine legali.

## 4. Test

1. `createFatturaPv`: conflitto sull'unique → ritorna `null`, non propaga
   l'errore. È il test che rende sicuro il nuovo vincolo.
2. `segnaFeeIncassato`: documento `IN_ATTESA` preesistente → diventa `PAGATA`,
   e **non** parte nessuna N53.
3. `segnaFeeIncassato`: documento appena creato (già `PAGATA`) → la
   `updateMany` non cambia nulla, nessuna regressione sul percorso normale.
4. Termini: gli spazi del testo nuovo, sul DOM.

## 5. Rilascio

Ordine vincolante, e stavolta la migration **non** è additiva-innocua come
l'`ALTER TYPE` del rilascio precedente: un indice unico può fallire sui dati
esistenti.

1. Query di controllo duplicati su Neon (read-only).
2. Se pulita, migration; se non pulita, si decide caso per caso prima di
   procedere — i dati di produzione sono usa-e-getta, quindi cancellare il
   duplicato è un'opzione legittima.
3. Push.

La migration si scrive **a mano** e si applica con `db:deploy`: in questo repo
`pnpm db:migrate` (`prisma migrate dev`) propone DROP di sequenze. Il file
conterrà il `CREATE UNIQUE INDEX` che Prisma genererebbe per
`@@unique([praticaId, tipo])`, con il nome che Prisma si aspetta
(`documenti_fiscali_praticaId_tipo_key`) — un nome diverso farebbe risultare lo
schema in deriva al primo `migrate status`.

## Fuori scope

- La race fra `anno` (calcolato in JS) ed `emessoAt` (scritto da `now()` del
  DB): due sorgenti di clock che possono disallinearsi attorno alla mezzanotte
  di Roma. Preesistente all'architettura, finestra di poche centinaia di
  millisecondi. Il fix corretto è catturare un solo istante e passarlo anche a
  `emessoAt` nella `create`.
- Nota di credito automatica su dispute o rimborsi SEPA: `createNotaCredito`
  resta il codice non agganciato che è oggi.
- Nessun backfill: i dati di produzione sono usa-e-getta.
