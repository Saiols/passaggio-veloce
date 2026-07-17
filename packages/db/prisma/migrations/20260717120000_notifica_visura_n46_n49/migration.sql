-- Ciclo di vita visura camerale: preavviso scadenza, scadenza effettiva,
-- congelamento pratica (broker) e ATECO non idoneo all'aggiornamento (admin).

-- AlterEnum
ALTER TYPE "NotificaTipo" ADD VALUE 'N46_VISURA_IN_SCADENZA';
ALTER TYPE "NotificaTipo" ADD VALUE 'N47_VISURA_SCADUTA';
ALTER TYPE "NotificaTipo" ADD VALUE 'N48_BROKER_PRATICA_CONGELATA';
ALTER TYPE "NotificaTipo" ADD VALUE 'N49_ADMIN_ATECO_NON_IDONEO';
