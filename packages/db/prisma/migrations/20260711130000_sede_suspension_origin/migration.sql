-- Origine della sospensione di sede: una sanzione anti-abuso non deve essere
-- revocabile dal sanzionato (prima lo era: stesso campo suspendedAt).
CREATE TYPE "SedeSuspensionOrigin" AS ENUM ('UTENTE', 'ANTI_ABUSO');

ALTER TABLE "sedi" ADD COLUMN "suspensionOrigin" "SedeSuspensionOrigin";

-- Backfill: le sedi già sospese sono attribuite all'UTENTE. È la scelta
-- conservativa — non trasformiamo retroattivamente in sanzioni (irrevocabili
-- dall'utente) sospensioni che l'utente potrebbe essersi disposto da sé.
UPDATE "sedi" SET "suspensionOrigin" = 'UTENTE' WHERE "suspendedAt" IS NOT NULL;
