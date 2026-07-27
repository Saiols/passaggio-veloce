-- Riconciliazione CRM ↔ aziende registrate (spec 2026-07-27).
--
-- Il match per telefono non poteva scattare: si confrontava il numero
-- normalizzato della Company con `crm_contacts.tel` grezzo ("+39 02 447 8712").
-- Da qui in avanti le chiavi di confronto sono colonne indicizzate, scritte
-- dall'helper unico lib/crm/match/norm-fields.ts.
--
-- ⚠️ MIGRATION DI SOLA ESPANSIONE, colonne NULLABLE: va lanciata PRIMA del
-- deploy del codice nuovo ed è compatibile con quello vecchio, che le ignora.
--
-- ⚠️ BUCO DI ROLLOUT: nella finestra fra questa migration e il deploy del
-- codice nuovo, il codice VECCHIO continua a creare/modificare CrmContact
-- scrivendo tel/wa/email/piva grezzi ma NON conosce ancora `crmNormFields`,
-- quindi lascia telNorm/waNorm/emailNorm/pivaNorm a NULL sulle righe toccate
-- in quella finestra. Quelle righe restano invisibili sia al nuovo
-- anti-duplicato sia al motore di match, che leggono solo le colonne
-- normalizzate. I sei UPDATE di backfill qui sotto sono idempotenti: vanno
-- RIESEGUITI (query intere, o filtrate con `WHERE "telNorm" IS NULL` /
-- `"waNorm" IS NULL` / `"emailNorm" IS NULL` / `"pivaNorm" IS NULL` per
-- toccare solo le righe mancanti) SUBITO DOPO il deploy del codice nuovo, per
-- chiudere quel buco.
ALTER TABLE "crm_contacts" ADD COLUMN "telNorm" TEXT;
ALTER TABLE "crm_contacts" ADD COLUMN "waNorm" TEXT;
ALTER TABLE "crm_contacts" ADD COLUMN "emailNorm" TEXT;
ALTER TABLE "crm_contacts" ADD COLUMN "pivaNorm" TEXT;
ALTER TABLE "crm_contacts" ADD COLUMN "sedeId" UUID;
ALTER TABLE "crm_contacts" ADD COLUMN "matchVia" TEXT;
ALTER TABLE "crm_contacts" ADD COLUMN "matchedAt" TIMESTAMP(3);

CREATE INDEX "crm_contacts_telNorm_idx" ON "crm_contacts"("telNorm");
CREATE INDEX "crm_contacts_waNorm_idx" ON "crm_contacts"("waNorm");
CREATE INDEX "crm_contacts_emailNorm_idx" ON "crm_contacts"("emailNorm");
CREATE INDEX "crm_contacts_pivaNorm_idx" ON "crm_contacts"("pivaNorm");
CREATE INDEX "crm_contacts_sedeId_idx" ON "crm_contacts"("sedeId");

ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_sedeId_fkey"
  FOREIGN KEY ("sedeId") REFERENCES "sedi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: stessa logica di normalizeTel/normalizeEmail/normalizePiva.
UPDATE "crm_contacts" SET "telNorm" = CASE
    WHEN regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g') LIKE '0039%'
      THEN substr(regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g'), 5)
    WHEN regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g') LIKE '39%'
     AND length(regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g')) > 10
      THEN substr(regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g'), 3)
    ELSE regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g')
  END;
UPDATE "crm_contacts" SET "waNorm" = CASE
    WHEN regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g') LIKE '0039%'
      THEN substr(regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g'), 5)
    WHEN regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g') LIKE '39%'
     AND length(regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g')) > 10
      THEN substr(regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g'), 3)
    ELSE regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g')
  END;
UPDATE "crm_contacts" SET "telNorm" = NULL WHERE length(COALESCE("telNorm", '')) < 8;
UPDATE "crm_contacts" SET "waNorm" = NULL WHERE length(COALESCE("waNorm", '')) < 8;

UPDATE "crm_contacts" SET "emailNorm" = NULLIF(lower(btrim(COALESCE("email", ''))), '');

UPDATE "crm_contacts" SET "pivaNorm" = regexp_replace(COALESCE("piva", ''), '[^0-9]', '', 'g');
UPDATE "crm_contacts" SET "pivaNorm" = NULL WHERE length(COALESCE("pivaNorm", '')) <> 11;
