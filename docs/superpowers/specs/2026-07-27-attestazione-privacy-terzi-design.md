# Attestazione tracciabile dell'informativa ai terzi (pre-invio pratica)

**Data:** 2026-07-27
**Stato:** design approvato, da implementare
**Natura:** DRAFT tecnico — tocca una prova con valenza legale, ma **non modifica** `/termini` né `/privacy`

---

## 1. Il punto di partenza (e una premessa da correggere)

La richiesta nasce da una conversazione di Alberto: aggiungere nella modale pre-invio una
checkbox obbligatoria con cui il broker dichiara di aver informato venditore e acquirente del
trattamento dei loro dati, registrandone timestamp, IP e ID utente.

**Quella checkbox esiste già.** È arrivata con la release GDPR dati terzi del 2026-07-14
(`docs/superpowers/specs/2026-07-14-gdpr-dati-terzi-design.md`). Oggi, in prod:

- `components/dichiarazione-popup.tsx` mostra il bullet «Hai **informato venditore e
  acquirente** che i loro dati e documenti sono trasmessi a Passaggio Veloce»;
- la checkbox obbligatoria recita «Confermo di aver verificato quanto sopra, **di aver
  informato venditore e acquirente sul trattamento dei loro dati (clausola 23 dei Termini)**
  e mi assumo piena responsabilità»;
- il blocco non è solo UI: `app/pratiche/nuova/actions.ts:754` rifiuta il submit senza il flag;
- ogni invio scrive un record `BrokerDichiarazione` con `praticaId`, `userId`, `ip`,
  `userAgent`, `popupVersion`, `createdAt`.

Va corretta anche la citazione: la clausola indicata come **19.2** nella conversazione è oggi
la **23.2**, rinumerata col merge del documento v8 del 2026-07-26. Il codice non scrive quel
numero a mano, lo legge da `ART_DATI_TERZI` (`lib/legal/clausole-vessatorie.ts`).

Questa spec non introduce quindi l'attestazione: **la rende una prova che regge.**

## 2. I quattro buchi

### 2.1 Il record è best-effort — il buco che conta

```ts
// actions.ts:1672
// Best-effort: se fallisce il log non blocchiamo il submit, ma resta
// tracciata l'accettazione via flag formData.
try {
  await prisma.brokerDichiarazione.create({ /* … */ });
} catch {
  // best-effort log
}
```

La `create` sta **fuori** dalla transazione che crea la pratica, dentro un `catch` vuoto. Se
l'insert fallisce, la pratica parte lo stesso e la prova non esiste — senza che nessuno se ne
accorga. Il commento si consola dicendo che l'accettazione «resta tracciata via flag
formData», ma quel flag è un campo di una richiesta HTTP già conclusa: non è tracciato da
nessuna parte.

Un log best-effort che deve fare da prova legale non è né un log né una prova.

### 2.2 Il testo non è persistito, solo la sua versione

`popupVersion` identifica il testo per riferimento. Il changelog in `lib/penali/config.ts`
dimostra da solo quanto sia fragile: `v3.1` esiste **unicamente** perché è cambiato un numero
di clausola (17 → 23) a parità di ogni altra parola. Il commento in
`clausole-vessatorie.ts` avverte di bumpare la versione a ogni rinumerazione — ma è
disciplina umana. Una modifica al copy senza bump rende due testi diversi indistinguibili, e
l'audit non sa più cosa l'utente ha letto.

### 2.3 La versione arriva dal client, non validata

`wizard.tsx:1630` invia `PENALI.POPUP_VERSION` nel `FormData`; il server la accetta come
`z.string().trim().min(1).max(20)` e la scrive nel record. Un campo d'audit valorizzato da
una stringa arbitraria di chi quell'audit lo deve subire.

### 2.4 Nessuno legge il record

`brokerDichiarazione` compare in `src/` solo nella `create` e in due mock di test. Alla prima
contestazione la prova va estratta a mano dal DB.

## 3. Cosa NON facciamo

**Non ri-presentiamo l'accettazione di Termini e Privacy nella modale.** L'accettazione è già
persistita con la versione (`Company.termsVersion`) ed esiste già un meccanismo di
ri-accettazione quando i Termini cambiano (`lib/tariffe/riaccettazione.ts`, `/tariffe-aggiornate`).
Una spunta "accetto i Termini" ripetuta a ogni pratica non aggiunge nulla di giuridicamente
nuovo e indebolisce quello che c'è: una spunta data quaranta volte al mese diventa rumore, ed
è l'argomento che un legale avversario userebbe per svuotarla. L'attestazione sui terzi è
diversa proprio perché è **per-pratica**: riguarda *quel* venditore e *quel* acquirente.

**Non de-anonimizziamo l'IP.** Oggi `anonimizeIp()` maschera l'ultimo ottetto (`93.45.201.x`)
e la `/privacy` pubblica **dichiara** questa anonimizzazione («indirizzo IP (anonimizzato a 3
ottetti)», `app/privacy/page.tsx:105`). Registrare l'IP pieno renderebbe falso un documento
legale pubblicato per guadagnare un ottetto che non serve: `userId` + timestamp + user-agent
identificano già chi ha spuntato, che è l'unica cosa da provare.

## 4. Il design

### 4.1 Fonte unica versionata — `lib/legal/attestazioni.ts`

```ts
export const ATTESTAZIONI_VERSION = 'v4.0';

/** `CUMULATIVA` esiste solo nelle versioni ≤ v3.1, dove la spunta era una sola. */
export type IdAttestazione = 'CUMULATIVA' | 'RESPONSABILITA' | 'TERZI';
export type Attestazione = { id: IdAttestazione; testo: string };

export const REGISTRO_ATTESTAZIONI: Record<string, readonly Attestazione[]> = {
  // Storiche, congelate: servono solo a rendere leggibili i record già scritti.
  'v3.0': [
    {
      id: 'CUMULATIVA',
      testo:
        'Confermo di aver verificato quanto sopra, di aver informato venditore e ' +
        'acquirente sul trattamento dei loro dati (clausola 17 dei Termini) e mi assumo ' +
        'piena responsabilità',
    },
  ],
  'v3.1': [
    {
      id: 'CUMULATIVA',
      testo:
        'Confermo di aver verificato quanto sopra, di aver informato venditore e ' +
        'acquirente sul trattamento dei loro dati (clausola 23 dei Termini) e mi assumo ' +
        'piena responsabilità',
    },
  ],
  'v4.0': [
    {
      id: 'RESPONSABILITA',
      testo:
        'Confermo di aver verificato quanto sopra (assenza di fermi amministrativi, ' +
        'ipoteche o vincoli iscritti al PRA, autenticità dei documenti caricati) e mi ' +
        'assumo piena responsabilità.',
    },
    {
      id: 'TERZI',
      testo:
        "Dichiaro di aver informato il venditore e l'acquirente che i loro documenti e " +
        'dati personali saranno trattati da Passaggio Veloce S.r.l. per la gestione della ' +
        "presente pratica, ai sensi dell'Informativa Privacy per venditori e acquirenti " +
        '(passaggioveloce.it/privacy/clienti) e della clausola 23 dei Termini.',
    },
  ],
};
```

**I testi sono stringhe letterali, non template che interpolano `ART_DATI_TERZI`.** Se il
numero di clausola entrasse nella stringa per interpolazione, una rinumerazione dei Termini
cambierebbe in silenzio il significato di una versione **già persistita**: i record vecchi
citerebbero un numero che al momento della spunta non era scritto da nessuna parte. È
esattamente il rischio che `clausole-vessatorie.ts` descrive.

Al posto della disciplina umana, un vincolo meccanico: un test asserisce che il testo della
versione corrente contiene il valore attuale di `ART_DATI_TERZI`. Chi rinumera i Termini
trova il test rosso e deve aprire una versione nuova.

`PENALI.POPUP_VERSION` viene deprecato: la costante e il suo changelog si spostano qui,
accanto al testo che descrivono. `lib/penali/config.ts` resta la fonte degli importi.

### 4.2 La modale: due spunte

`DichiarazionePopup` passa da `accepted: boolean` a due stati distinti, **entrambi
obbligatori** per abilitare "Conferma e invia":

```
☑ Confermo di aver verificato quanto sopra (assenza di fermi amministrativi,
  ipoteche o vincoli iscritti al PRA, autenticità dei documenti caricati) e mi
  assumo piena responsabilità.

☑ Dichiaro di aver informato il venditore e l'acquirente che i loro documenti e
  dati personali saranno trattati da Passaggio Veloce S.r.l. per la gestione della
  presente pratica, ai sensi dell'Informativa Privacy per venditori e acquirenti
  e della clausola 23 dei Termini.

                                          [ Annulla ]  [ Conferma e invia ]
```

Perché separate: un'attestazione autonoma è un atto consapevole; la stessa frase annegata in
un periodo che parla di fermi amministrativi e penali è una riga che si spunta senza leggere.

«Informativa Privacy per venditori e acquirenti» è un `<Link href="/privacy/clienti">`
**relativo** — non `BRAND.url`, che punta al dominio marketing. Il testo persistito cita
l'URL in chiaro perché il link renderizzato non sopravvive alla serializzazione.

Il bullet «Hai informato venditore e acquirente…» **esce dall'elenco puntato**: con la spunta
dedicata due righe più sotto sarebbe una ripetizione.

Il resto della modale (fermi, ipoteche, documenti, visura ACI, penale, documenti in
originale) non cambia.

### 4.3 Scrittura atomica

La `create` si sposta **dentro** la `$transaction` di `actions.ts:1344`, usando `tx`, e il
`try/catch` sparisce. `getRequestMetadata()` viene chiamata **prima** di aprire la
transazione: `headers()` è async e non ha ragione di stare dentro.

Semantica nuova: **non esiste una pratica inviata senza la sua prova, né una prova senza
pratica.**

> ⚠️ Questo trasforma un fallimento oggi silenzioso in un fallimento **bloccante**: se
> l'insert va male, la creazione della pratica fallisce e il broker vede un errore. È il
> comportamento corretto per una prova legale, ma è un cambio di rischio operativo da
> mettere in conto, non solo una correzione.

### 4.4 Validazione della versione

Il client continua a inviare la versione che **ha renderizzato**, e questo è voluto: dopo un
deploy, un browser rimasto aperto sul wizard mostra ancora il testo vecchio, ed è quello che
l'utente ha letto. Prendere la costante server-side registrerebbe una versione che
l'utente non ha mai visto.

Ma la stringa viene ora **validata contro le chiavi di `REGISTRO_ATTESTAZIONI`**, e i testi
persistiti sono letti dal registro server-side — mai dal payload. Versione sconosciuta →
submit rifiutato con invito a ricaricare la pagina. Meglio rifiutare un invio che registrare
un'attestazione di cui non conosciamo il contenuto.

Nel payload `dichiarazioneAccettata` si affianca a `attestazioneTerziAccettata`: entrambi
obbligatori a `true`, entrambi bloccanti server-side come già oggi la prima. Ma la spec è
onesta su cosa sono: il wizard li scrive a `'true'` di suo (`wizard.tsx:1629`), quindi il
server non sta verificando il click — sta rifiutando una richiesta malformata. Il gate reale
sul gesto dell'utente è il bottone disabilitato.

### 4.5 Schema e migration

```prisma
model BrokerDichiarazione {
  // … campi esistenti invariati
  popupVersion      String
  testoAttestazioni Json?   // [{ id, testo }] — copia del testo effettivamente reso
  clausolaTerzi     Int?    // ART_DATI_TERZI al momento della spunta
}
```

Nullable perché i record scritti dal go-live (2026-07-22) a oggi non hanno i campi nuovi, e
si dividono in due versioni: `v3.0` fino al 26/07 (testo che cita la **clausola 17**) e
`v3.1` da lì in poi (**clausola 23**, dopo la rinumerazione del documento v8). **Nessun
backfill**: entrambe entrano nel registro col loro testo storico e la card le rende per
intero partendo dalla versione. È il motivo per cui il registro tiene le versioni vecchie
invece di solo l'ultima — ed è anche la prova che il bump di versione, quando viene fatto,
funziona.

Migration scritta **a mano** e applicata su Neon con `pnpm db:deploy` — `pnpm db:migrate`
propone `DROP SEQUENCE`. Va applicata **prima** del push del codice, che scrive subito le
colonne nuove.

### 4.6 Card admin

In `app/pratiche/[id]/page.tsx`, blocco gated `isAdminPiattaforma`:

```
—— Attestazione del broker ———————————————————————
 15/03/2027, 14:32:07  ·  IP 93.45.201.x
 Mario Rossi · mario@autodealer.it
 Versione popup v4.0

 ✓ "Confermo di aver verificato quanto sopra…"
 ✓ "Dichiaro di aver informato il venditore e l'acquirente…"

 user-agent: Mozilla/5.0 (Windows NT 10.0…
```

Testi da `testoAttestazioni` se presente, altrimenti dal registro tramite `popupVersion`. Se
anche la versione è ignota, la card **lo dice** invece di mostrare un vuoto: un blocco vuoto
si legge come "nessuna attestazione", che è la conclusione opposta.

Nessuna route nuova, nessuna vista nel dettaglio pratica di broker e agenzia: la prova serve
a chi risponde a una contestazione.

## 5. Impatto legale

**Nessuna modifica a `/termini` e `/privacy`.** L'art. 23.2 già impone all'Utente la garanzia
di aver reso l'informativa ai Terzi; questa è la **prova** di quella garanzia, non una
clausola nuova. Di conseguenza: nessuna rigenerazione della KB del chatbot (che si costruisce
dai docs al prebuild), nessun bump di `TERMS_VERSION`, nessun passaggio dal legale.

Resta vero il contrario: se un domani la 23.2 viene riscritta, il testo della spunta va
riallineato **e versionato**, perché il record cita la clausola per numero.

## 6. Verifiche

**Test sul registro** (`lib/legal/attestazioni.test.ts`)

- il testo della versione corrente contiene il valore attuale di `ART_DATI_TERZI`;
- le versioni storiche sono immutabili (snapshot esatto delle stringhe);
- `id` univoci dentro ogni versione, e la versione corrente copre esattamente
  `RESPONSABILITA` e `TERZI` (`CUMULATIVA` è ammesso solo nelle versioni storiche).

**Test sull'action** — da scrivere **rossi prima del fix**, altrimenti non dimostrano nulla:

- submit con una sola spunta → rifiutato;
- submit con versione fuori registro → rifiutato;
- record creato con i testi del registro, non con quelli del payload (payload manomesso →
  vince il registro);
- **se la `create` della dichiarazione fallisce, la pratica non esiste.** È il test che prova
  la rimozione del best-effort: oggi passerebbe al contrario, con la pratica creata e la
  prova assente.

**Verifica nel browser, col gesto reale** (non navigando per URL)

Aprire la modale, spuntare una sola casella e constatare il bottone disabilitato, spuntarle
entrambe, inviare, poi rileggere la card admin sulla pratica creata. Due bug React recenti —
una tab che si spegneva, un focus rubato da un modale — erano invisibili ai test e visibili
solo nel DOM.

## 7. File toccati

| File | Cosa |
|---|---|
| `lib/legal/attestazioni.ts` | **nuovo** — registro versionato dei testi |
| `lib/legal/attestazioni.test.ts` | **nuovo** — invarianti del registro |
| `lib/penali/config.ts` | `POPUP_VERSION` deprecata, changelog spostato |
| `components/dichiarazione-popup.tsx` | due spunte, link all'Informativa, bullet rimosso |
| `app/pratiche/nuova/wizard.tsx` | due stati, payload con i due flag |
| `app/pratiche/nuova/actions.ts` | validazione versione, `create` dentro la transazione |
| `app/pratiche/[id]/page.tsx` | card attestazione (admin) |
| `packages/db/prisma/schema.prisma` | due colonne nullable |
| `packages/db/prisma/migrations/…` | migration a mano |
