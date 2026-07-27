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
-- `AND "telNorm" IS NULL` / `AND "waNorm" IS NULL` / `AND "emailNorm" IS NULL`
-- / `AND "pivaNorm" IS NULL` per toccare solo le righe mancanti.

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
