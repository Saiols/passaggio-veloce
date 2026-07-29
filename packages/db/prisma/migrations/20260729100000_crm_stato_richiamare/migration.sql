-- packages/db/prisma/migrations/20260729100000_crm_stato_richiamare/migration.sql
-- Stato S11 "Richiamare": il cliente ha chiesto di essere richiamato, e quando.
--
-- Sta in una migration TUTTA SUA perché Postgres non permette di USARE un
-- valore enum nella stessa transazione in cui lo aggiunge, e Prisma esegue
-- ogni migration dentro una transazione. Separarlo è ciò che rende sicura la
-- migration successiva (e qualunque futura che voglia scrivere 'S11').
ALTER TYPE "CrmStatoContatto" ADD VALUE 'S11';
