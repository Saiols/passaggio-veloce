-- Venditore ↔ Veicolo: legame per i passaggi multipli (additivo, nullable).
ALTER TABLE "venditori" ADD COLUMN "veicoloId" UUID;
CREATE INDEX "venditori_veicoloId_idx" ON "venditori"("veicoloId");
ALTER TABLE "venditori" ADD CONSTRAINT "venditori_veicoloId_fkey" FOREIGN KEY ("veicoloId") REFERENCES "veicoli"("id") ON DELETE SET NULL ON UPDATE CASCADE;
