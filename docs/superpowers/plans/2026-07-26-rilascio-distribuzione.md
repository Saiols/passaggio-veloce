# Rilascio in produzione — distribuzione round in minuti + calendario

**Data:** 2026-07-26
**Branch:** `main` locale, 25 commit avanti su `origin/main` (fermo a `4b84037`)
**Eseguito da:** Francesco (i passi su produzione non sono automatizzati)

## Perché non basta `pnpm --filter @pv/db db:deploy`

La release contiene **tre** migration, e una di esse è distruttiva:

| Migration | Tipo | Quando |
|---|---|---|
| `20260726120000_distribuzione_calendario` | additiva (2 colonne + seed festivi) | **prima** del push |
| `20260726140000_zona_non_coperta_prima` | additiva (1 colonna + backfill) | **prima** del push |
| `20260726130000_drop_orario_legacy` | **DROP** di 3 colonne | **dopo** il deploy |

`prisma migrate deploy` applica **tutte** le migration pendenti in ordine di timestamp: lanciato prima del push eseguirebbe anche il DROP, e il codice ancora in produzione — che legge `orarioInizio`/`orarioFine`/`giorni` — cadrebbe nel `catch` fail-open di `getDistribuzioneConfig`, ignorando in silenzio la configurazione reale.

Nel verso opposto il rischio è peggiore: le due additive devono precedere il codice, perché il codice nuovo fa `select` e `orderBy` su `orariSettimana`, `festivi` e `zonaNonCopertaPrimaAt`. Un deploy che arrivasse per primo romperebbe `/admin/monitoraggio` e il tick di distribuzione.

Da qui la sequenza sotto: SQL a mano, poi `migrate resolve` per allineare la tabella di stato di Prisma, e solo alla fine `db:deploy` per il DROP rimasto.

---

## Passo 0 — Pre-flight (obbligatorio)

Sul database di produzione (Neon **ep-solitary-night**, la stringa è `DATABASE_URL` su Vercel):

```sql
SELECT count(*) FROM distribuzione_config WHERE id = 'singleton';
```

**Deve restituire 1.** Se restituisse 0, **fermati**: i due `UPDATE` della prima migration sono `WHERE id = 'singleton'` e sarebbero no-op silenziosi — il calendario resterebbe `NULL` (il codice userebbe i default, senza segnalare nulla) e **il seed dei 16 festivi andrebbe perso**. In quel caso serve prima un `INSERT` della riga.

Annota anche lo stato di partenza, utile se qualcosa va storto:

```sql
SELECT * FROM distribuzione_config;
SELECT count(*) FROM pratiche WHERE "zonaNonCopertaAt" IS NOT NULL;
```

## Passo 1 — Le due migration additive, a mano

Esegui il contenuto **integrale** di questi due file sul database di produzione, in quest'ordine:

1. `packages/db/prisma/migrations/20260726120000_distribuzione_calendario/migration.sql`
   (aggiunge `orariSettimana` e `festivi`, converte la fascia oraria attuale nei sette giorni, semina i 16 festivi)
2. `packages/db/prisma/migrations/20260726140000_zona_non_coperta_prima/migration.sql`
   (aggiunge `zonaNonCopertaPrimaAt` e fa il backfill da `zonaNonCopertaAt`)

**Verifica prima di proseguire:**

```sql
SELECT jsonb_pretty("orariSettimana"), jsonb_array_length("festivi") FROM distribuzione_config;
```

Attesi: sette chiavi `LUN`..`DOM` con `attivo` true su LUN-VEN e false su SAB/DOM, orari 09:00–19:00 (sabato 09:00–13:00 ma spento), e **16** festivi.

```sql
SELECT count(*) FROM pratiche WHERE "zonaNonCopertaPrimaAt" IS NOT NULL;
```

Atteso: lo stesso numero contato al passo 0.

## Passo 2 — Allinea lo stato di Prisma

Con `DATABASE_URL` puntato a produzione, dalla root del repo:

```bash
pnpm --filter @pv/db exec prisma migrate resolve --applied 20260726120000_distribuzione_calendario
pnpm --filter @pv/db exec prisma migrate resolve --applied 20260726140000_zona_non_coperta_prima
```

Marca le due come già applicate senza rieseguirle. Da qui in avanti l'unica pendente è il DROP.

Controllo:

```bash
pnpm --filter @pv/db exec prisma migrate status
```

Deve elencare **una sola** migration pendente: `20260726130000_drop_orario_legacy`.

## Passo 3 — Push (= deploy)

```bash
git push origin main
```

Attendi che il deploy Vercel sia `READY`.

## Passo 4 — Verifica il deploy prima di droppare

1. **Il cron al minuto è attivo?** Dopo ~10 minuti, i runtime log di produzione devono mostrare ~10 richieste su `/api/jobs/distribuzione-tick` invece di 1. Se Vercel avesse rifiutato lo schedule `* * * * *`, il ripiego è cron-job.org sullo stesso path con header `Authorization: Bearer <CRON_SECRET>`, che `requireAdminOrCron` accetta già senza modifiche al codice.
2. **Il pannello legge il calendario?** Apri `/admin/distribuzione`: devi vedere "Durata round (minuti)" a 60, i sette giorni con LUN-VEN attivi, e i 16 festivi.
3. **Il monitoraggio funziona?** Apri `/admin/monitoraggio`: è la pagina che usa la colonna nuova, quindi è la prova che il backfill e il codice si parlano.
4. **Una pratica si apre?** Apri una pratica qualsiasi da `/admin/pratiche` e verifica che compaia la card "Copertura".

Se uno di questi fallisce, **non droppare**: le tre colonne vecchie sono ancora lì e il rollback è un `git revert` + redeploy.

## Passo 5 — Il DROP

Solo ora, e solo se il passo 4 è andato:

```bash
pnpm --filter @pv/db db:deploy
```

Applica l'unica migration rimasta. Verifica:

```sql
\d distribuzione_config
```

Le colonne `orarioInizio`, `orarioFine`, `giorni` non devono più esistere; `orariSettimana` e `festivi` sì, con i dati.

## Passo 6 — Dopo

- **Ruota le credenziali Neon**, come da prassi del progetto ogni volta che la stringa di connessione viene usata fuori da Vercel.
- Configura il calendario reale dal pannello se vuoi discostarti dal default (per esempio il sabato mattina: è già precompilato 09:00–13:00, basta spuntarlo).
- Le pratiche già in "zona non coperta" ripartiranno da sole al primo tick utile in orario lavorativo, se nel frattempo esiste un'agenzia idonea in zona. In produzione al momento sono zero.

## Se qualcosa va storto

| Sintomo | Causa probabile | Rimedio |
|---|---|---|
| Il pannello mostra 09:00–19:00 LUN-VEN anche dopo aver salvato altro | il codice non vede le colonne nuove → fail-open sui default | le additive non sono state applicate, o `migrate resolve` è stato fatto senza eseguire l'SQL |
| `/admin/monitoraggio` in errore | manca `zonaNonCopertaPrimaAt` | applica la migration `20260726140000` |
| Zero festivi nel pannello | la riga `singleton` non esisteva al passo 0 | inserisci la riga e riesegui i soli `UPDATE` della migration `20260726120000` |
| Il cron gira ancora ogni 10 minuti | `vercel.json` non riletto | verifica che il deploy sia andato a buon fine e che sia il deploy di produzione |
