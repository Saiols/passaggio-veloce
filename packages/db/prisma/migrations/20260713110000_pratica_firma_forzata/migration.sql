-- Attestazione della firma da parte del Gestore (Termini, art. 11).
-- Non esiste un audit log di azioni in piattaforma: si usa il pattern gia'
-- in casa (colonna ...DaId + ...At + nota), come per segnalazioneEsitaDaId.
ALTER TABLE "pratiche" ADD COLUMN "firmaForzataDaId" UUID;
ALTER TABLE "pratiche" ADD COLUMN "firmaForzataAt" TIMESTAMP(3);
ALTER TABLE "pratiche" ADD COLUMN "firmaForzataMotivo" TEXT;
