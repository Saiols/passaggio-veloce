-- Separazione "tipo soggetto" ↔ "variante CI" (step 3/3: rimozione vecchi valori).
-- Postgres non supporta DROP VALUE su un enum: si ricrea il tipo senza i valori
-- deprecati e si migrano le colonne (cast via text). Sicuro solo dopo il backfill
-- (step 2): nessuna riga usa più PRIVATO_ITALIANO_CIE/CARTACEA.

CREATE TYPE "TipoSoggetto_new" AS ENUM ('PRIVATO_ITALIANO', 'STRANIERO_EXTRA_UE', 'AZIENDA', 'OPERATORE_AUTO');

ALTER TABLE "pratiche" ALTER COLUMN "acquirenteTipoSoggetto" TYPE "TipoSoggetto_new" USING ("acquirenteTipoSoggetto"::text::"TipoSoggetto_new");
ALTER TABLE "venditori" ALTER COLUMN "tipoSoggetto" TYPE "TipoSoggetto_new" USING ("tipoSoggetto"::text::"TipoSoggetto_new");
ALTER TABLE "co_acquirenti" ALTER COLUMN "tipoSoggetto" TYPE "TipoSoggetto_new" USING ("tipoSoggetto"::text::"TipoSoggetto_new");

ALTER TYPE "TipoSoggetto" RENAME TO "TipoSoggetto_old";
ALTER TYPE "TipoSoggetto_new" RENAME TO "TipoSoggetto";
DROP TYPE "TipoSoggetto_old";
