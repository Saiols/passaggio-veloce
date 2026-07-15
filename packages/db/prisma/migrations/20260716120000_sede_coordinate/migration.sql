-- Coordinate geografiche sulle sedi (per la mappa CRM e usi geo futuri).
ALTER TABLE "sedi"
  ADD COLUMN "lat" DOUBLE PRECISION,
  ADD COLUMN "lng" DOUBLE PRECISION,
  ADD COLUMN "geocodedAt" TIMESTAMP(3);
