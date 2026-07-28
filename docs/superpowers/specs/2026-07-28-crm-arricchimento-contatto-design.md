# Arricchimento del contatto CRM dai dati dell'iscrizione

**Data:** 2026-07-28
**Stato:** design approvato, da implementare

## Problema

Il motore di riconciliazione (`lib/crm/match/`, spec
`2026-07-27-crm-riconciliazione-design.md`) aggancia una riga della lista CRM
all'azienda che si è registrata sulla piattaforma. L'aggancio funziona, ma
scrive solo il legame e il funnel: `companyId`, `sedeId`, `matchVia`,
`matchedAt`, `iscrizioneComp`, `iscrizioneAt`, `status`, `platStatus`.

L'anagrafica del contatto resta quella della lista di partenza, con i suoi
buchi. Il caso concreto: migliaia di righe importate da CSV non hanno l'email —
il venditore apre un contatto che si è iscritto ieri, con tutti i dati veri già
nel DB a una join di distanza, e vede il campo Email vuoto.

## Obiettivo

Quando un'iscrizione si aggancia a un contatto, i campi anagrafici **vuoti** del
contatto vengono riempiti con i dati dell'identità registrata. Solo i vuoti: un
dato raccolto al telefono non viene mai sovrascritto.

Vale sia per i nuovi agganci sia per i contatti già agganciati (che oggi in prod
sono già lì con l'email vuota), e resta vero nel tempo — se un'azienda aggiunge
il cellulare sei mesi dopo, la passata successiva lo riporta nel CRM.

## Non obiettivi

- Non si sovrascrive mai un campo valorizzato, nemmeno se il dato registrato è
  diverso. Riconciliare due valori in conflitto è una decisione umana e ha il
  suo posto: il form del contatto.
- Non si arricchiscono i contatti non agganciati. Senza `companyId` non c'è una
  sorgente.
- Non si tocca `onPraticaFirmata`: quel percorso muove il funnel, non
  l'anagrafica, e il cron ripassa comunque.

## Architettura

Un modulo puro con la regola, due chiamanti.

```
lib/crm/match/arricchimento.ts   (PURO — nessun DB)
        │  calcolaArricchimento(contatto, sorgente) → patch | null
        │
        ├── apply.ts        → dopo un aggancio riuscito (nuovi match)
        └── sync.ts         → syncCrmFromPlatform (già agganciati, ogni notte)
```

L'alternativa scartata era tenere la logica dentro `apply.ts` e riusarne solo la
scrittura dal cron: `apply.ts` è già il file più denso del motore, e una regola
di merge anagrafico mescolata alla logica di aggancio è il tipo di codice che
poi viene duplicato invece che riusato.

Scartata anche la passata separata (un terzo job che ignora `apply.ts`): un
contatto appena agganciato resterebbe senza email fino alla notte dopo, cioè
proprio nel momento in cui il venditore lo apre.

### Modulo puro

```ts
export type SorgenteArricchimento = {
  company: {
    email: string;
    telefono: string | null;
    partitaIva: string;
    indirizzo: string;
    civico: string | null;
    citta: string;
    cap: string;
    provincia: string;
  };
  sede: {
    email: string | null;
    telefono: string | null;
    indirizzo: string;
    civico: string | null;
    citta: string;
    cap: string;
    provincia: string;
  } | null;
};

export type ContattoDaArricchire = {
  wa: string | null;
  email: string | null;
  piva: string | null;
  indirizzo: string | null;
  citta: string | null;
  cap: string | null;
  regione: string | null;
};

export type PatchArricchimento = {
  /** Solo i campi da scrivere, già pronti per Prisma. */
  dati: Partial<Record<CampoArricchibile, string>>;
  /** Gli stessi campi come elenco: guardia CAS + audit. */
  campi: CampoArricchibile[];
};

export function calcolaArricchimento(
  contatto: ContattoDaArricchire,
  sorgente: SorgenteArricchimento,
): PatchArricchimento | null;
```

`pec` non è nella sorgente: vedi la regola sotto.

### Regole

In ordine di applicazione.

1. **Solo buchi.** Un campo entra nella patch solo se nel contatto è `null` o
   una stringa vuota/di soli spazi. Il CSV di partenza ha stringhe vuote dove
   il dato mancava, quindi `null` da solo non basta.
2. **Sede prima, madre dopo.** Se il match è su una sede (`sedeId` valorizzato)
   i campi vengono dalla sede; dove la sede non ha il dato — `email` e
   `telefono` sono opzionali su `Sede` — si scende alla madre. `piva` viene
   sempre e solo dalla madre: la sede non ne ha una.
3. **`email`: mai la PEC.** La PEC resta chiave di match in `identita.ts`, ma
   non finisce nel campo Email del CRM: è la casella che il venditore userà per
   scrivere al lead, e una PEC non è un indirizzo di contatto commerciale.
4. **`wa` solo se è un cellulare.** Nel form del contatto `tel` è etichettato
   "Telefono fisso" e `wa` è "WhatsApp". Scrivere il fisso dell'azienda in `wa`
   crea un canale che non esiste. Si riempie solo se il numero normalizzato è un
   mobile italiano (prefisso `3`); altrimenti il campo resta vuoto.
5. **`tel` non si arricchisce mai.** È obbligatorio su `CrmContact` (decisione
   11): non può essere vuoto, quindi non ha buchi da riempire.
6. **`nome` non si arricchisce mai.** Stesso motivo, ed è il campo su cui il
   venditore riconosce la riga.
7. **`indirizzo` = `indirizzo` + `civico`** in una stringa sola (`'Via Roma 12'`),
   come già fa l'import CSV: `CrmContact` non ha la colonna `civico`.
8. **`regione` derivata da `provincia`** tramite una mappa nuova
   `lib/geo/province.ts` (107 sigle → le forme canoniche già in
   `lib/crm/regione.ts`, che resta la fonte unica dei nomi). Sigla non
   riconosciuta → campo non scritto, mai un valore inventato.
9. **Valore sorgente vuoto → campo non scritto.** Riempire un buco con un altro
   buco sporca solo l'audit.
10. **Patch vuota → `null`.** Così i chiamanti saltano la scrittura senza
    inventarsi un controllo proprio.

### Colonne normalizzate

`wa`, `email` e `piva` hanno le rispettive colonne `*Norm` usate dal match. Si
ricalcolano **solo per i campi effettivamente scritti**, passando da
`crmNormFields` (`lib/crm/match/norm-fields.ts`) e mai a mano: è la fonte unica,
e un `emailNorm` calcolato altrove è esattamente il modo in cui le colonne si
desincronizzano in silenzio. `telNorm` non si tocca, perché `tel` non si tocca.

Nessun rischio di violare vincoli: su `crm_contacts` le colonne `*Norm` hanno
indici semplici, non unici.

## Scrittura

```ts
export async function applicaArricchimento(
  contactId: string,
  patch: PatchArricchimento,
  /** I valori letti insieme al contatto: servono per il CAS e per l'audit. */
  letto: ContattoDaArricchire & { arricchitoDa: string | null },
): Promise<boolean>;
```

`updateMany` con compare-and-set **sui campi stessi**, confrontati con il valore
appena letto:

```ts
where: {
  id: contactId,
  deletedAt: null,
  // { email: null, citta: '' } — il valore esatto che aveva alla lettura.
  ...Object.fromEntries(patch.campi.map((c) => [c, letto[c]])),
  // L'audit è derivato da una lettura, quindi va guardato come i campi.
  arricchitoDa: letto.arricchitoDa,
}
```

`arricchitoDa` sta nella guardia perché è un valore **accumulato** da una
lettura precedente, esattamente come `status` in `apply.ts`. Senza, due
scritture concorrenti che riempiono campi diversi passano entrambe — la
seconda calcola il CSV da uno stato ormai vecchio e cancella la voce della
prima. I campi resterebbero giusti e l'audit mentirebbe, che è il modo
peggiore di sbagliare per una colonna che esiste solo per dire la verità su
com'è arrivato un dato.

Conseguenza accettata: se `arricchitoDa` è cambiato fra lettura e scrittura
fallisce l'intera patch, campi compresi. Quei campi sono ancora vuoti e li
riempie la passata successiva — un giro di ritardo in un caso raro costa meno
di un audit sbagliato. Nessun retry.

Il confronto è sul valore letto e non su `null`/`''`: la regola 1 considera
vuoto anche un campo di soli spazi, e una guardia scritta come
`OR: [{ c: null }, { c: '' }]` non lo intercetterebbe — la scrittura tornerebbe
`count: 0` e il campo resterebbe vuoto per sempre, senza che nulla lo segnali.

La guardia non è teorica: fra il calcolo e la scrittura un admin può aver
compilato l'email a mano dal pannello. Senza, il cron notturno gliela
sovrascriverebbe con quella della registrazione — dato perso, in silenzio. Con
la guardia `count` torna 0 e l'arricchimento non si applica in quel giro. È lo
stesso schema di `apply.ts`, dove il CAS protegge lo stato del funnel.

`deletedAt: null` nel `where` per lo stesso motivo di `apply.ts`: non si scrive
su una riga cancellata contandola come arricchita.

### Audit

Due colonne nuove su `CrmContact`:

- `arricchitoDa String?` — elenco CSV dei campi mai arricchiti, es.
  `"email,citta,regione"`.
- `arricchitoAt DateTime?` — ultima passata che ha scritto qualcosa.

`arricchitoDa` si **unisce**, non si rimpiazza: se una prima passata scrive
`email` e sei mesi dopo l'azienda aggiunge il cellulare, il campo diventa
`email,wa`. L'unione avviene sul valore letto insieme al contatto, ordinata in
modo stabile per non produrre diff casuali.

## Punti di aggancio

### `apply.ts` — nuovi agganci

Dentro `applicaProposte`, subito dopo `res.count > 0`.

I dati anagrafici arrivano dalla `Proposta`: l'engine ha già company e sedi in
memoria (`SELECT_COMPANY`), quindi **zero query in più**. Servono due modifiche
piccole:

- aggiungere `provincia` a `SELECT_COMPANY` (company e sedi) e ai tipi
  `CompanyGrezza`/`SedeGrezza` in `identita.ts`;
- portare in `Proposta` un campo `sorgente: SorgenteArricchimento`, costruito in
  `engine.ts` dall'identità scelta.

L'arricchimento gira in un `try/catch` proprio: un arricchimento fallito non
deve far contare come errore un aggancio riuscito, che è già stato scritto.

`EsitoApply` guadagna `arricchiti: number` (contatti su cui la patch è stata
scritta), che risale in `EsitoRiconciliazione` e nella pagina admin.

### `sync.ts` — contatti già agganciati

Dentro il giro di `syncCrmFromPlatform`, che già scorre tutti i contatti con
`companyId` valorizzato.

La `findMany` iniziale seleziona anche i campi anagrafici e `arricchitoDa`, così
i buchi si calcolano **senza query aggiuntive**: se il contatto è completo — il
caso normale dopo la prima passata — non si legge nulla e non si scrive nulla.
Solo quando ci sono buchi si legge la sede (`sedeId`); la company è già letta
lì, va solo esteso il `select` con i campi anagrafici.

Il valore di ritorno guadagna `arricchiti`, riportato nel JSON della route
`api/jobs/crm-sync` insieme a quello della riconciliazione.

Nessun backfill separato: la prima esecuzione del cron copre i già agganciati.

## UI

Nel dettaglio contatto (`admin/crm/contatti/client.tsx`, `TabAnagrafica`), una
riga in cima al tab, visibile solo se `arricchitoDa` è valorizzato:

> ✓ Dati completati dall'iscrizione — email, città, regione · 28/07/2026

I campi si mostrano con le etichette del form (Email, Città, …), non con i nomi
delle colonne. Niente indicatore per singolo campo: sarebbero sette pallini in
un form già denso, e l'informazione utile è "questi dati non li ha detti al
telefono", non quale casella è quale.

## Migration

Scritta a mano — `prisma migrate dev` è distruttivo su questo schema — e
applicata con `db:deploy`:

```sql
-- packages/db/prisma/migrations/20260728HHMMSS_crm_contacts_arricchimento/migration.sql
ALTER TABLE "crm_contacts" ADD COLUMN "arricchitoDa" TEXT;
ALTER TABLE "crm_contacts" ADD COLUMN "arricchitoAt" TIMESTAMP(3);
```

Nessun indice: non si filtra su queste colonne.

⚠️ **Va applicata su Neon prima del push.** Il codice legge `arricchitoDa` nella
query dei contatti: senza colonna, la pagina CRM contatti va giù in prod.

## Test e verifica

**Unitari sul modulo puro** (`arricchimento.test.ts`), nessun DB:

- campo già valorizzato (`'x'`) → non entra nella patch; campo di soli spazi
  (`'  '`) → considerato vuoto, entra nella patch, e la guardia CAS lo ritrova
  confrontandolo con `'  '`;
- match su sede → vince la sede; sede senza email → scende alla madre;
- `piva` presa dalla madre anche quando il match è su una sede;
- PEC mai usata come `email`;
- `wa` scritto con un cellulare, scartato con un fisso;
- `indirizzo` composto con e senza `civico`;
- `regione` da sigla valida, campo assente da sigla ignota;
- contatto completo → `null`;
- `arricchitoDa` unito al precedente, senza duplicati.

**Sulla mappa province** (`province.test.ts`): tutte le 107 sigle mappano a una
regione presente in `REGIONI_ITALIANE`, e le 20 regioni sono tutte coperte.

**Su `apply.ts` e `sync.ts`** col mock Prisma: la CAS scarta la scrittura se il
campo nel frattempo si è riempito; un errore di arricchimento non intacca il
conteggio degli agganci; contatto senza buchi → nessuna query aggiuntiva.

**Sul DB locale** (copia di prod): le query nuove eseguite in read-only prima di
chiudere, per vedere quanti contatti agganciati hanno effettivamente buchi e
quanti ne verrebbero riempiti.

**Nel browser**: pannello contatto aperto sul serio, per la riga di audit.
