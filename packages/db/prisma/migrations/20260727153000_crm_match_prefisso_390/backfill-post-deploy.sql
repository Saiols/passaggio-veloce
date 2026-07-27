-- Backfill DEFINITIVO e RIESEGUIBILE per crm_contacts (fonte unica).
--
-- NON è una migration Prisma (il nome del file non è `migration.sql`, quindi
-- `prisma migrate deploy` lo ignora): è lo script operativo da lanciare a
-- mano, in psql, SUBITO DOPO il deploy del codice che scrive
-- telNorm/waNorm/emailNorm/pivaNorm via `crmNormFields` (vedi Task 3).
--
-- Perché serve: nella finestra fra la migration `20260727150000` (a caldo,
-- PRIMA del deploy) e il deploy del codice nuovo, il codice VECCHIO continua
-- a creare/modificare CrmContact scrivendo tel/wa/email/piva grezzi senza
-- popolare le colonne normalizzate — quelle righe restano con
-- telNorm/waNorm/emailNorm/pivaNorm a NULL e sono invisibili sia al nuovo
-- anti-duplicato sia al motore di match.
--
-- ⚠️ QUESTO file sostituisce il backfill del commento in
-- `20260727150000_crm_match_normalizzato/migration.sql`: quella SQL è
-- SUPERATA — non contiene la correzione del prefisso '390' (un blocco di
-- cifre che inizia per '390' è sempre prefisso internazionale + fisso,
-- qualunque sia la lunghezza — vedi `20260727153000_crm_match_prefisso_390/
-- migration.sql` e `lib/crm/match/normalize.ts::normalizeTel`). Riesguire
-- SOLO gli UPDATE della migration `20260727150000` ripopolerebbe righe nuove
-- con la formula vecchia (es. '+39 055 46501' → '3905546501' invece di
-- '05546501'), riaprendo in silenzio lo stesso bug che l'emendamento 390
-- aveva chiuso sui dati storici. Usa SEMPRE questo file per i re-run.
--
-- Idempotente: si può rilanciare tutto, oppure filtrare con
-- `WHERE "telNorm" IS NULL` / `WHERE "waNorm" IS NULL` / `WHERE "emailNorm" IS
-- NULL` / `WHERE "pivaNorm" IS NULL` per toccare solo le righe mancanti.
-- (`WHERE`, non `AND`: i quattro UPDATE qui sotto non hanno alcuna clausola
-- WHERE propria, quindi chi seguisse l'istruzione alla lettera scriverebbe
-- SQL non valido.)
--
-- ⚠️ ORDINE DI RILASCIO E CAUTELA SU NEON
-- Le tre migration di questa feature vanno applicate a mano su Neon PRIMA del
-- push del codice, in quest'ordine: `20260727150000_crm_match_normalizzato`,
-- `20260727153000_crm_match_prefisso_390`, e infine
-- `20260727160000_crm_contacts_company_sede_unique` (quest'ultima solo dopo la
-- verifica di assenza duplicati documentata nel suo migration.sql).
-- Su Neon risultano pendenti anche migration arrivate da `main`: un
-- `prisma migrate deploy` a valanga le applicherebbe tutte insieme. Lanciare
-- SEMPRE `prisma migrate status` sul database di produzione prima, e poi
-- applicare in modo mirato solo le tre migration di questa feature.
-- Questo file va rieseguito DOPO il deploy del codice.

-- telNorm / waNorm: stessa logica di normalizeTel (0039% → 390% → 39% con
-- più di 10 cifre → invariato), poi azzeramento sotto le 8 cifre.
UPDATE "crm_contacts" SET "telNorm" = CASE
    WHEN regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g') LIKE '0039%'
      THEN substr(regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g'), 5)
    WHEN regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g') LIKE '390%'
      THEN substr(regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g'), 3)
    WHEN regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g') LIKE '39%'
     AND length(regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g')) > 10
      THEN substr(regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g'), 3)
    ELSE regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g')
  END;
UPDATE "crm_contacts" SET "waNorm" = CASE
    WHEN regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g') LIKE '0039%'
      THEN substr(regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g'), 5)
    WHEN regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g') LIKE '390%'
      THEN substr(regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g'), 3)
    WHEN regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g') LIKE '39%'
     AND length(regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g')) > 10
      THEN substr(regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g'), 3)
    ELSE regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g')
  END;
UPDATE "crm_contacts" SET "telNorm" = NULL WHERE length(COALESCE("telNorm", '')) < 8;
UPDATE "crm_contacts" SET "waNorm" = NULL WHERE length(COALESCE("waNorm", '')) < 8;

-- emailNorm / pivaNorm: nessun bug qui, stessa logica invariata dalla
-- migration `20260727150000` (trim+minuscolo; 11 cifre esatte).
UPDATE "crm_contacts" SET "emailNorm" = NULLIF(lower(btrim(COALESCE("email", ''))), '');

UPDATE "crm_contacts" SET "pivaNorm" = regexp_replace(COALESCE("piva", ''), '[^0-9]', '', 'g');
UPDATE "crm_contacts" SET "pivaNorm" = NULL WHERE length(COALESCE("pivaNorm", '')) <> 11;

-- ═══════════════════════════════════════════════════════════════════════════
-- QUERY DI CHIUSURA — deve restituire 0. Se restituisce un numero > 0 il
-- backfill post-deploy NON è servito (non è stato lanciato, è stato lanciato
-- prima del deploy, o è fallito a metà) e va rilanciato.
--
-- Perché conta: nella finestra fra la migration e il deploy il codice VECCHIO
-- continua a scrivere righe con le colonne normalizzate vuote. Il nuovo
-- anti-duplicato dell'import CSV legge `telNorm`/`emailNorm` DAL DB invece di
-- ricalcolarli dal grezzo: una riga con `telNorm` nullo è invisibile a quel
-- controllo, quindi un duplicato che entra in lista senza fare rumore (ed è
-- anche invisibile al motore di match, che i candidati li sceglie sulle stesse
-- colonne). Questa query conta esattamente quelle righe: hanno un telefono
-- utilizzabile (≥ 8 cifre DOPO la normalizzazione) ma la chiave normalizzata
-- vuota.
--
-- ⚠️ La soglia delle 8 cifre va misurata sul telefono NORMALIZZATO, non sulle
-- cifre grezze. Verificato sul DB locale (copia di prod): la versione grezza
-- `length(regexp_replace(tel,'[^0-9]','','g')) >= 8` restituisce 6 righe anche
-- con il backfill perfettamente applicato — sono numeri come `+39 041 8890`
-- (9 cifre grezze) che dopo il taglio del prefisso `390` scendono a 6 cifre e
-- quindi hanno `telNorm` NULL per costruzione, correttamente. Con quella
-- versione la verifica non tornerebbe MAI 0 e l'operatore rilancerebbe il
-- backfill all'infinito.
--
-- SELECT count(*) FROM crm_contacts
-- WHERE "deletedAt" IS NULL AND "telNorm" IS NULL AND tel IS NOT NULL
--   AND length(CASE
--       WHEN regexp_replace(tel,'[^0-9]','','g') LIKE '0039%'
--         THEN substr(regexp_replace(tel,'[^0-9]','','g'), 5)
--       WHEN regexp_replace(tel,'[^0-9]','','g') LIKE '390%'
--         THEN substr(regexp_replace(tel,'[^0-9]','','g'), 3)
--       WHEN regexp_replace(tel,'[^0-9]','','g') LIKE '39%'
--        AND length(regexp_replace(tel,'[^0-9]','','g')) > 10
--         THEN substr(regexp_replace(tel,'[^0-9]','','g'), 3)
--       ELSE regexp_replace(tel,'[^0-9]','','g')
--     END) >= 8;
--
-- Sul DB locale, oggi, torna 0.
-- ═══════════════════════════════════════════════════════════════════════════
