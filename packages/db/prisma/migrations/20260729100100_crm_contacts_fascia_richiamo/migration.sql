-- packages/db/prisma/migrations/20260729100100_crm_contacts_fascia_richiamo/migration.sql
-- Fascia del richiamo programmato (mattina/pomeriggio) e indice per il chip
-- "Da richiamare".
--
-- La colonna è nullable e null significa "indifferente": nessun backfill, le
-- righe esistenti sono già corrette.
--
-- L'indice serve alle DUE query che il chip fa a ogni apertura della pagina:
-- il listato filtrato e il conteggio nel badge.
CREATE TYPE "CrmFasciaContatto" AS ENUM ('MATTINA', 'POMERIGGIO');

ALTER TABLE "crm_contacts" ADD COLUMN "nextContactFascia" "CrmFasciaContatto";

CREATE INDEX "crm_contacts_status_nextContactAt_idx"
  ON "crm_contacts" ("status", "nextContactAt");
