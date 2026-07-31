-- CreateEnum
CREATE TYPE "CrmGiudizio" AS ENUM ('INTERESSATO', 'NON_INTERESSATO');

-- AlterTable
ALTER TABLE "crm_contacts" ADD COLUMN "giudizio" "CrmGiudizio";
ALTER TABLE "crm_contacts" ADD COLUMN "linkApertoAt" TIMESTAMP(3);

-- Data migration: i giudizi soggettivi (S2/S3) diventano `giudizio`.
UPDATE "crm_contacts" SET "giudizio" = 'INTERESSATO' WHERE "status" = 'S3';
UPDATE "crm_contacts" SET "giudizio" = 'NON_INTERESSATO' WHERE "status" = 'S2';

-- I contatti in S2/S3/S11 non devono più portare un valore soggettivo/di richiamo
-- in `status`: si ricalcola il traguardo fattuale dai flag (stessa logica di
-- statoFattuale in lib/crm/fatti.ts). S11 mantiene nextContactAt/nextContactFascia,
-- perché il richiamo è ora un asse indipendente.
UPDATE "crm_contacts" SET "status" = (CASE
  WHEN "primaPratica" = true AND "praticheTotal" >= 2 THEN 'S9'
  WHEN "primaPratica" = true THEN 'S8'
  WHEN "iscrizioneComp" = true THEN 'S7'
  WHEN "iscrizioneInit" = true THEN 'S6'
  WHEN "linkAperto" = true THEN 'S5'
  WHEN "linkInviato" = true THEN 'S4'
  ELSE 'S0'
END)::"CrmStatoContatto"
WHERE "status" IN ('S2', 'S3', 'S11');
