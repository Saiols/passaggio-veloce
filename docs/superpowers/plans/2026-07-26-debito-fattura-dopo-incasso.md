# Debito residuo "fattura dopo l'incasso" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chiudere i tre residui del rilascio "fattura dopo l'incasso": rendere il DB garante dell'unicità della fattura per pratica, allineare `statoPagamento` quando l'incasso arriva su un documento nato dalla valvola, e far dire ai testi quello che il codice fa davvero.

**Architecture:** Il vincolo di unicità entra in `schema.prisma` come `@@unique([praticaId, tipo])` e `createFatturaPv` impara a tradurre il conflitto in `null`, che è già la sua semantica per "esisteva di già". La transizione di stato è una `updateMany` idempotente in `segnaFeeIncassato`. I testi si allineano a mano, con la guardia sugli spazi JSX già in essere a fare da rete.

**Tech Stack:** Prisma + Postgres (Neon in prod), Next.js 16 App Router, Vitest.

## Global Constraints

- **Una sola migration, e solo nel Task 1**: il `CREATE UNIQUE INDEX` per `@@unique([praticaId, tipo])`. Negli altri task una migration è il segnale che il task è sbagliato.
- **La migration si scrive a mano.** `pnpm db:migrate` (`prisma migrate dev`) in questo repo propone DROP di sequenze: si crea il file SQL a mano e si applica con `db:deploy`. Il nome dell'indice deve essere **esattamente** quello che Prisma si aspetta — `documenti_fiscali_praticaId_tipo_key` — altrimenti lo schema risulta in deriva al primo `migrate status`.
- **Nessun backfill**: i dati di produzione sono usa-e-getta, tutti gli account si ri-registrano.
- **Nessun `catch` muto**: ogni `.catch` best-effort logga con `console.error` includendo l'id dell'entità coinvolta, nello stile di `lib/fee/retry.ts:27-29`.
- **Mai `prettier` sulle pagine legali** (`termini`, `privacy`, `privacy/clienti`, `cookie`): il reflow automatico sposta gli a-capo dentro i nodi di testo e reintroduce le parole incollate. Si editano a mano, riga per riga.
- Comandi: `pnpm --filter piattaforma test <path>` per i test mirati (il filtro è `piattaforma`, senza scope), `pnpm typecheck` dalla root.
- Si lavora direttamente su `main`. Codice e commenti in italiano.

---

### Task 1: Il DB garantisce una sola fattura per pratica

Oggi `createFatturaPv` protegge l'unicità con `findFirst` + `create` nella stessa transazione, ma a READ COMMITTED due transazioni concorrenti leggono entrambe `null` e creano entrambe. Lo `@@unique([emittenteCompanyId, anno, numeroProgressivo, tipo])` esistente **non** vincola le `FATTURA_PV`: per loro `emittenteCompanyId` è `null`, e in Postgres i NULL sono distinti.

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (modello `DocumentoFiscale`, blocco degli attributi in fondo)
- Create: `packages/db/prisma/migrations/20260726180000_unique_fattura_per_pratica/migration.sql`
- Modify: `apps/piattaforma/src/lib/fatturazione/engine.ts:28-75`
- Test: `apps/piattaforma/src/lib/fatturazione/engine.test.ts`

**Interfaces:**
- La firma di `createFatturaPv` **non cambia**: `createFatturaPv(input: { feeAddebitoId: string; statoPagamento: 'IN_ATTESA' | 'PAGATA' }): Promise<{ id: string } | null>`. Cambia solo quando ritorna `null`: adesso anche quando perde la corsa sull'unique.

- [ ] **Step 1: Scrivi il test che fallisce**

In `apps/piattaforma/src/lib/fatturazione/engine.test.ts`, aggiungi in fondo al `describe('createFatturaPv', ...)`:

```ts
  it('conflitto sul vincolo (praticaId, tipo): ritorna null invece di propagare', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['praticaId', 'tipo'] },
      }),
    );
    const out = await createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'PAGATA' });
    expect(out).toBeNull();
  });

  it('un P2002 su un altro vincolo NON viene inghiottito', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['numeroDocumentoStr'] },
      }),
    );
    await expect(
      createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'PAGATA' }),
    ).rejects.toThrow('Unique constraint failed');
  });

  it('un errore qualsiasi NON viene inghiottito', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(new Error('connessione persa'));
    await expect(
      createFatturaPv({ feeAddebitoId: 'fee-1', statoPagamento: 'PAGATA' }),
    ).rejects.toThrow('connessione persa');
  });
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma test src/lib/fatturazione/engine.test.ts`
Expected: FAIL sul primo dei tre — oggi `createFatturaPv` non ha alcun `try/catch`, quindi il rigetto della `$transaction` risale al chiamante e il test riceve un throw invece di `null`. Gli altri due passano già (è corretto: sono i test di non-regressione che impediscono al fix di inghiottire troppo).

- [ ] **Step 3: Aggiungi il vincolo allo schema**

In `packages/db/prisma/schema.prisma`, nel modello `DocumentoFiscale`, accanto agli altri attributi in fondo al modello (dopo `@@unique([emittenteCompanyId, anno, numeroProgressivo, tipo])`):

```prisma
  /// Una sola FATTURA_PV per pratica. Lo unique sopra NON la copre: per le
  /// FATTURA_PV `emittenteCompanyId` è NULL e in Postgres i NULL sono
  /// distinti, quindi non vincola nulla. Senza questo indice l'idempotenza
  /// di `createFatturaPv` è un leggi-poi-scrivi che due chiamanti concorrenti
  /// (percorso d'incasso e riconciliazione oraria) possono attraversare
  /// entrambi. I DOC_BROKER hanno `praticaId` NULL e restano liberi.
  @@unique([praticaId, tipo])
```

- [ ] **Step 4: Scrivi la migration a mano**

Crea `packages/db/prisma/migrations/20260726180000_unique_fattura_per_pratica/migration.sql`:

```sql
-- Una sola FATTURA_PV per pratica.
--
-- Lo unique gia' presente su (emittenteCompanyId, anno, numeroProgressivo, tipo)
-- NON copre le FATTURA_PV: per loro `emittenteCompanyId` e' NULL e in Postgres
-- i NULL sono distinti, quindi quel vincolo non le tocca. Senza questo indice
-- l'idempotenza di createFatturaPv resta un leggi-poi-scrivi che due chiamanti
-- concorrenti (percorso d'incasso e riconciliazione oraria) possono
-- attraversare entrambi, producendo due documenti fiscali sulla stessa pratica.
--
-- Le righe con `praticaId` NULL (i DOC_BROKER, agganciati al payout) non sono
-- vincolate: in Postgres i NULL sono distinti fra loro.
--
-- Il nome dell'indice e' quello che Prisma genera per @@unique([praticaId, tipo]):
-- cambiarlo farebbe risultare lo schema in deriva al primo `migrate status`.
CREATE UNIQUE INDEX "documenti_fiscali_praticaId_tipo_key"
  ON "documenti_fiscali"("praticaId", "tipo");
```

- [ ] **Step 5: Applica in locale e rigenera il client**

Run: `pnpm --filter @pv/db db:deploy`
Expected: la migration risulta applicata.

Run: `pnpm --filter @pv/db db:generate`
Expected: client rigenerato senza errori.

Se `db:deploy` fallisce con un errore di indice duplicato sui dati locali, **fermati e segnala**: significa che la copia locale di produzione contiene già due `FATTURA_PV` sulla stessa pratica, e va deciso cosa farne prima di procedere. La query per vederli è in fondo a questo task.

- [ ] **Step 6: Traduci il conflitto in `null`**

In `apps/piattaforma/src/lib/fatturazione/engine.ts`, aggiungi sopra `createFatturaPv`:

```ts
/**
 * Conflitto sul vincolo `@@unique([praticaId, tipo])`, cioè: qualcun altro ha
 * appena creato la fattura di questa pratica mentre la creavamo noi.
 *
 * Il controllo è ristretto al target e non al solo codice: un `P2002` sul
 * `numeroDocumentoStr` è un'altra cosa — segnala un contatore fiscale che ha
 * prodotto un numero già usato — e non deve passare in silenzio.
 *
 * Duck typing invece di `instanceof PrismaClientKnownRequestError`: questo
 * modulo importa `Prisma` solo come tipo, e la forma dell'errore (`code` +
 * `meta.target`) è parte del contratto pubblico di Prisma.
 */
function isConflittoFatturaPratica(err: unknown): boolean {
  const e = err as { code?: unknown; meta?: { target?: unknown } } | null;
  if (e?.code !== 'P2002') return false;
  const target = e.meta?.target;
  const campi = Array.isArray(target)
    ? target.map(String)
    : typeof target === 'string'
      ? [target]
      : [];
  return campi.includes('praticaId') && campi.includes('tipo');
}
```

e avvolgi il corpo di `createFatturaPv` (la sola riga `return prisma.$transaction(...)` diventa un `try`):

```ts
  const anno = romeAnnoCivile(new Date());
  try {
    return await prisma.$transaction(async (tx) => {
      // ... corpo invariato ...
    });
  } catch (err) {
    // Chi perde la corsa si comporta come chi arriva secondo: `null` è già la
    // semantica di "esisteva di già". Il rollback della transazione riporta
    // indietro anche il contatore fiscale, quindi non resta un buco di
    // numerazione.
    if (isConflittoFatturaPratica(err)) return null;
    throw err;
  }
```

Nota: `return prisma.$transaction(...)` diventa `return await prisma.$transaction(...)` — senza `await` il rigetto sfuggirebbe al `try`.

Aggiorna il doc-comment della funzione: fra i motivi che producono `null` va aggiunto "o perché un altro chiamante l'ha creata nello stesso istante".

- [ ] **Step 7: Esegui i test e il typecheck**

Run: `pnpm --filter piattaforma test src/lib/fatturazione src/lib/fee src/lib/jobs`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Verifica la query di controllo duplicati sul DB locale**

Questa query serve a chi rilascia, prima di applicare la migration su Neon. Verifica che giri e che sul locale non restituisca righe:

```
psql "$DATABASE_URL" -c "SELECT \"praticaId\", COUNT(*) FROM documenti_fiscali WHERE tipo = 'FATTURA_PV' AND \"praticaId\" IS NOT NULL GROUP BY \"praticaId\" HAVING COUNT(*) > 1;"
```

Riportala nel report: è il passo che chi rilascia dovrà eseguire su produzione **prima** della migration. Se non hai `psql` disponibile, usa il container Postgres locale del progetto e dillo nel report.

- [ ] **Step 9: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/piattaforma/src/lib/fatturazione/engine.ts apps/piattaforma/src/lib/fatturazione/engine.test.ts
git commit -m "feat(fatturazione): una sola FATTURA_PV per pratica, garantita dal DB"
```

---

### Task 2: L'incasso allinea `statoPagamento` dei documenti della valvola

In modalità live `createFatturaPv` crea già `PAGATA`, quindi gli unici documenti `IN_ATTESA` che esisteranno mai sono quelli nati dalla valvola nell'era mock. Al passaggio a `stripe` verrebbero incassati davvero e resterebbero marcati "non pagata": un dato fiscale falso a video.

**Files:**
- Modify: `apps/piattaforma/src/lib/fee/incasso.ts`
- Test: `apps/piattaforma/src/lib/fee/incasso.test.ts`

**Interfaces:**
- Consumes: `createFatturaPv({ feeAddebitoId, statoPagamento }): Promise<{ id: string } | null>` (Task 1, firma invariata).
- La firma di `segnaFeeIncassato(feeId: string, providerRef: string): Promise<boolean>` **non cambia**.

- [ ] **Step 1: Scrivi il test che fallisce**

In `apps/piattaforma/src/lib/fee/incasso.test.ts`, aggiungi `docUpdateMany: vi.fn()` al blocco `vi.hoisted`, esponilo nel mock di `@pv/db` come `documentoFiscale: { updateMany: docUpdateMany }` accanto a `feeAddebito`, e in `beforeEach` aggiungi `docUpdateMany.mockResolvedValue({ count: 0 })` e fai restituire a `feeFindUnique` anche la pratica: `feeFindUnique.mockResolvedValue({ agenziaId: 'ag-1', praticaId: 'pr-1' })`.

Poi i test:

```ts
  it('allinea a PAGATA una fattura rimasta IN_ATTESA (documento della valvola)', async () => {
    await segnaFeeIncassato('fee-1', 'pi_1');
    expect(docUpdateMany).toHaveBeenCalledWith({
      where: { praticaId: 'pr-1', tipo: 'FATTURA_PV', statoPagamento: 'IN_ATTESA' },
      data: { statoPagamento: 'PAGATA' },
    });
  });

  it("l'allineamento non fa partire una seconda N53", async () => {
    createFatturaPvMock.mockResolvedValue(null); // documento già esistente
    docUpdateMany.mockResolvedValue({ count: 1 }); // ed era IN_ATTESA: allineato ora
    await segnaFeeIncassato('fee-1', 'pi_1');
    expect(notificaMock).not.toHaveBeenCalled();
  });

  it("un errore nell'allineamento non annulla l'incasso", async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      docUpdateMany.mockRejectedValue(new Error('db giù'));
      await expect(segnaFeeIncassato('fee-1', 'pi_1')).resolves.toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('pr-1'),
        expect.any(Error),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma test src/lib/fee/incasso.test.ts`
Expected: FAIL — `docUpdateMany` non viene mai chiamata, `segnaFeeIncassato` oggi non tocca i documenti esistenti.

- [ ] **Step 3: Implementa l'allineamento**

In `apps/piattaforma/src/lib/fee/incasso.ts`, estendi la `select` del fee (oggi prende solo `agenziaId`):

```ts
  const fee = await prisma.feeAddebito.findUnique({
    where: { id: feeId },
    select: { agenziaId: true, praticaId: true },
  });
```

e aggiungi, **dopo** il blocco `createFatturaPv` + N53 e prima di `return true`:

```ts
  // Allinea il documento nato dalla valvola: in modalità mock la fattura è
  // emessa alla firma con `IN_ATTESA`, e senza questo passaggio resterebbe
  // "non pagata" anche dopo che i soldi sono arrivati davvero. Idempotente:
  // se il documento è appena nato è già `PAGATA` e la updateMany non tocca
  // nulla.
  //
  // Nessuna N53 qui: quel documento ha già viaggiato allegato alla N8 e ha
  // `inviatoEmailAt` valorizzato — rimandarlo sarebbe una seconda consegna
  // della stessa fattura.
  if (fee) {
    await prisma.documentoFiscale
      .updateMany({
        where: { praticaId: fee.praticaId, tipo: 'FATTURA_PV', statoPagamento: 'IN_ATTESA' },
        data: { statoPagamento: 'PAGATA' },
      })
      .catch((err) => {
        console.error(
          `[segnaFeeIncassato] allineamento statoPagamento fallito per pratica ${fee.praticaId}:`,
          err,
        );
      });
  }
```

- [ ] **Step 4: Esegui i test e il typecheck**

Run: `pnpm --filter piattaforma test src/lib/fee src/lib/jobs`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/fee/incasso.ts apps/piattaforma/src/lib/fee/incasso.test.ts
git commit -m "feat(fatturazione): l'incasso allinea a PAGATA le fatture della valvola"
```

---

### Task 3: I testi dicono quello che il codice fa

`docs/sistema-fatturazione.md` §1.2-1.3 mette la generazione fattura allo step 2 e l'addebito allo step 4. Quel file entra nella KB del chatbot — `apps/piattaforma/scripts/build-chatbot-kb.ts` legge **ogni** `.md` di `docs/` (non ricorsivo: `docs/superpowers/**` resta fuori) — quindi è già adesso quello che il chatbot racconta alle agenzie.

**Files:**
- Modify: `docs/sistema-fatturazione.md` (tabelle §1.2 e §1.3, più le altre occorrenze della vecchia sequenza)
- Modify: `apps/piattaforma/src/app/termini/page.tsx` (clausole 9 e 11)
- Test: `apps/piattaforma/src/app/termini/spazi-jsx.test.ts` (esistente, deve restare verde)

**Interfaces:** nessuna, è un task di solo testo.

- [ ] **Step 1: Trova tutte le occorrenze della vecchia sequenza**

Run: `grep -rn "Generazione fattura\|Addebito agenzia\|emissione della relativa fattura" docs/*.md apps/piattaforma/src/app/termini/page.tsx`

Riporta l'elenco nel report: le due tabelle sono il minimo, ma se la sequenza è descritta anche altrove va allineata lì. **Non** toccare `docs/superpowers/**` (spec e piani sono documenti storici, e non entrano nella KB).

- [ ] **Step 2: Riordina la tabella §1.2 (trapasso netto)**

In `docs/sistema-fatturazione.md`, la tabella del flusso per trapasso netto ha oggi questo ordine: `1 Pratica FIRMATA` → `2 Generazione fattura PV` → `3 Generazione documento broker` → `4 Addebito agenzia` → `5 Accredito wallet broker` → …

L'addebito deve precedere la fattura, e la fattura va legata all'incasso. **Sostituisci la tabella intera** con quella qui sotto — non tagliare righe: payout, documento broker e trasmissione SDI restano, cambia solo dove stanno.

| Step | Evento | Documento generato | Emittente | Destinatario |
|---|---|---|---|---|
| 1 | Pratica `FIRMATA` | — | — | — |
| 2 | Accredito wallet broker (somme di terzi) | — (transazione interna) | — | Wallet broker (€25 ord / €20 forf) |
| 3 | Notifica firma a broker e agenzia | Email (N4 broker, N8 agenzia — **senza** fattura allegata) | Sistema | Broker + Agenzia |
| 4 | Addebito agenzia (SEPA, disposto alla firma) | — | — | PV incassa €75 totali |
| 5 | **Incasso confermato** → generazione fattura PV | Fattura €50 (ord) / €55 (forf) — PDF + XML TD01 | Passaggio Veloce S.r.l. | Agenzia |
| 6 | Notifica fattura disponibile (N53) | Email con PDF allegato | Sistema | Agenzia |
| 7 | Soglia payout raggiunta | — | — | Broker (notifica N5/N24) |
| 8 | Payout | Bonifico SEPA | PV | IBAN broker |
| 9 | Generazione documento broker (**al payout**) | Doc. €25 (ord, TD01) / €20 (forf, TD06) — PDF + XML | PV per conto del broker (delega contrattuale) | Passaggio Veloce (somme di terzi) |
| 10 | Trasmissione SDI doc. broker | — | Broker (manuale, fuori piattaforma) | SDI / Agenzia delle Entrate |

Due celle cambiano oltre all'ordine, ed è deliberato — la tabella le dava sbagliate e questo file alimenta il chatbot:

- **Il documento broker si genera al payout, non subito dopo la firma.** `createDocBroker` è chiamata da `lib/wallet/payout-exec.ts:127` e prende in ingresso un `payoutId`, non una pratica: verificalo tu prima di scrivere.
- **Il suo destinatario è PV, non l'agenzia.** In `createDocBroker` (`lib/fatturazione/engine.ts`): `emittenteCompanyId: broker.id`, `destinatarioCompanyId: null`, `datiDestinatario: pvEmittente()`. È un documento conto terzi che il broker emette verso PV.

Aggiungi subito sotto la tabella una riga di prosa:

> La fattura PV nasce **all'incasso confermato dell'addebito**, non alla firma: per una prestazione di servizi il momento impositivo è il pagamento (art. 6 D.P.R. 633/1972). Con addebito SEPA la conferma arriva dopo alcuni giorni lavorativi, quindi fra la chiusura della pratica e la fattura passa del tempo.

Non toccare il resto della sezione §1.2 (la nota sull'affiliazione, i riferimenti alle quote): cambia solo la tabella e la prosa qui sopra.

- [ ] **Step 3: Riordina la tabella §1.3 (minivoltura)**

Stessa logica, tabella più corta. Oggi: `1 Pratica FIRMATA` → `2 Generazione fattura PV` → `3 Addebito agenzia` → `4 Notifica agenzia`. Diventa:

| Step | Evento | Documento generato | Emittente | Destinatario |
|---|---|---|---|---|
| 1 | Pratica `FIRMATA` | — | — | — |
| 2 | Notifica firma all'agenzia | Email (N8 — **senza** fattura allegata) | Sistema | Agenzia |
| 3 | Addebito agenzia (SEPA, disposto alla firma) | — | — | PV incassa €30 (standard) o N×€20 (multipla) |
| 4 | **Incasso confermato** → generazione fattura PV | Fattura €30 (standard) / €20 per veicolo (multipla) — PDF + XML TD01 | Passaggio Veloce S.r.l. | Agenzia |
| 5 | Notifica fattura disponibile (N53) | Email con PDF allegato | Sistema | Agenzia |

Il caso degenerato descritto sopra la tabella (dealer e broker coincidono, nessuna delega, nessun documento broker) resta valido e non va toccato.

- [ ] **Step 4: Rigenera la KB e verifica che il chatbot cambi versione**

Run: `pnpm --filter piattaforma kb:build`
Expected: stampa i conteggi `public=… clients=… internal=…` senza errori.

Run: `grep -c "Incasso confermato" apps/piattaforma/src/lib/providers/chatbot/kb/kb.generated.ts`
Expected: almeno 1. Se è 0, il file non è finito nella KB e va capito perché prima di proseguire.

- [ ] **Step 5: Correggi la clausola 11 dei Termini**

In `apps/piattaforma/src/app/termini/page.tsx`, la clausola 11 contiene oggi:

```
            L&apos;attestazione produce <strong>tutti gli effetti della segnalazione ordinaria</strong>:
            perfezionamento della pratica, maturazione del compenso del Broker, addebito della fee a
            carico dell&apos;Agenzia ed emissione della relativa fattura.
```

Sostituisci con:

```
            L&apos;attestazione produce <strong>tutti gli effetti della segnalazione ordinaria</strong>:
            perfezionamento della pratica, maturazione del compenso del Broker e addebito della fee a
            carico dell&apos;Agenzia. La fattura relativa è emessa ad avvenuto incasso dell&apos;addebito.
```

- [ ] **Step 6: Integra la clausola 9 dei Termini**

Sempre in `apps/piattaforma/src/app/termini/page.tsx`, la clausola 9 dice oggi:

```
            Le agenzie autorizzano Passaggio Veloce ad addebitare il proprio conto mediante addebito
            diretto SEPA (SEPA Direct Debit) per gli importi delle fee dovute ai sensi della clausola
            3, secondo le tempistiche indicate in Piattaforma. Il mandato è revocabile secondo lo
            standard SDD; la revoca non fa venir meno gli importi già maturati.
```

Aggiungi una frase dopo «indicate in Piattaforma.» — l'addebito ora è davvero contestuale alla firma, e il testo può dirlo:

```
            Le agenzie autorizzano Passaggio Veloce ad addebitare il proprio conto mediante addebito
            diretto SEPA (SEPA Direct Debit) per gli importi delle fee dovute ai sensi della clausola
            3, secondo le tempistiche indicate in Piattaforma. L&apos;addebito è disposto alla
            registrazione della firma; l&apos;incasso segue i tempi dello standard SDD e la fattura è
            emessa ad avvenuto incasso. Il mandato è revocabile secondo lo standard SDD; la revoca
            non fa venir meno gli importi già maturati.
```

Nota sul perché il testo nuovo non contiene tag inline: la guardia `spazi-jsx.test.ts` esiste perché in produzione sono state trovate 21 parole incollate dove un tag inline di chiusura era seguito da uno spazio letterale e da un testo che andava a capo. Scrivere prosa senza `<strong>` in mezzo evita l'intera classe di problemi. Se ti serve un `<strong>`, scrivi `</strong>{' '}` e non `</strong> `.

- [ ] **Step 7: Esegui la guardia sugli spazi**

Run: `pnpm --filter piattaforma test src/app/termini`
Expected: PASS. La guardia scansiona l'intero file, quindi copre già il testo nuovo senza modifiche al test.

Se torna rossa: **non cancellare il test**. Applica il rimedio che indica (`{' '}` al posto dello spazio letterale) al punto che segnala, senza toccare il testo legale.

- [ ] **Step 8: Verifica sul DOM renderizzato, non sul sorgente**

I byte del sorgente non provano il testo renderizzato: è esattamente il motivo per cui quelle 21 parole incollate sono arrivate in produzione. Avvia `pnpm dev`, apri `/termini` e rileggi le clausole 9 e 11 nel browser, controllando che non ci siano parole attaccate fra loro.

Se non puoi avviare il dev server, dichiaralo esplicitamente nel report come **non eseguito** e spiega perché — non darlo per fatto.

- [ ] **Step 9: Esegui la suite completa e il typecheck**

Run: `pnpm --filter piattaforma test`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add docs/sistema-fatturazione.md apps/piattaforma/src/app/termini/page.tsx apps/piattaforma/src/lib/providers/chatbot/kb/kb.generated.ts
git commit -m "docs(fatturazione): i testi descrivono la fattura emessa dopo l'incasso"
```

---

## Dopo il piano — fuori dal codice

1. **Query di controllo duplicati su Neon, PRIMA della migration** (read-only). A differenza dell'`ALTER TYPE` del rilascio precedente, un indice unico **può fallire sui dati esistenti**:

   ```
   SELECT "praticaId", COUNT(*) FROM documenti_fiscali
   WHERE tipo = 'FATTURA_PV' AND "praticaId" IS NOT NULL
   GROUP BY "praticaId" HAVING COUNT(*) > 1;
   ```

   Se restituisce righe, vanno risolte prima: i dati di produzione sono usa-e-getta, quindi cancellare il duplicato più recente è un'opzione legittima.
2. **Migration su Neon, poi push.** `pnpm --filter @pv/db db:deploy` con `DATABASE_URL` di produzione, verificando con `migrate status` che non resti nulla di pendente.
3. **Far rivedere al legale** le clausole 9 e 11 riscritte: i Termini sono in produzione ma marcati DRAFT in attesa di revisione, e questo intervento le tocca nel merito.

## Fuori scope

- La race fra `anno` (calcolato in JS) ed `emessoAt` (scritto da `now()` del DB) attorno alla mezzanotte di Roma: preesistente, finestra di poche centinaia di millisecondi. Il fix corretto è catturare un solo istante e passarlo anche a `emessoAt` nella `create`.
- Nota di credito automatica su dispute o rimborsi SEPA: `createNotaCredito` resta non agganciata.
- La riconciliazione oraria **non** copre la transizione `IN_ATTESA` → `PAGATA`: il suo ramo 1 scarta le pratiche che hanno già una `FATTURA_PV`, quindi non vedrebbe i documenti da allineare. Scelta deliberata — sarebbe macchina in più per una popolazione transitoria.
