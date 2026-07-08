-- CreateEnum
CREATE TYPE "SegnalazioneCreazioneStato" AS ENUM ('APERTA', 'GESTITA');
CREATE TYPE "TipoProblemaSegnalazione" AS ENUM ('LETTURA_DATI', 'COMPILAZIONE', 'ALTRO');

-- CreateTable
CREATE TABLE "segnalazioni_creazione" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sedeId" UUID,
    "step" INTEGER NOT NULL,
    "tipo" "TipoProblemaSegnalazione" NOT NULL,
    "descrizione" TEXT NOT NULL,
    "datiSnapshot" JSONB NOT NULL,
    "stato" "SegnalazioneCreazioneStato" NOT NULL DEFAULT 'APERTA',
    "notaGestione" TEXT,
    "gestitaAt" TIMESTAMP(3),
    "gestitaDaId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "segnalazioni_creazione_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "segnalazioni_creazione_stato_createdAt_idx" ON "segnalazioni_creazione"("stato", "createdAt");
CREATE INDEX "segnalazioni_creazione_companyId_idx" ON "segnalazioni_creazione"("companyId");

-- AlterTable
ALTER TABLE "documenti" ADD COLUMN "segnalazioneId" UUID;

-- CreateIndex
CREATE INDEX "documenti_segnalazioneId_idx" ON "documenti"("segnalazioneId");

-- AddForeignKey
ALTER TABLE "segnalazioni_creazione" ADD CONSTRAINT "segnalazioni_creazione_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "segnalazioni_creazione" ADD CONSTRAINT "segnalazioni_creazione_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "segnalazioni_creazione" ADD CONSTRAINT "segnalazioni_creazione_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedi"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "segnalazioni_creazione" ADD CONSTRAINT "segnalazioni_creazione_gestitaDaId_fkey" FOREIGN KEY ("gestitaDaId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documenti" ADD CONSTRAINT "documenti_segnalazioneId_fkey" FOREIGN KEY ("segnalazioneId") REFERENCES "segnalazioni_creazione"("id") ON DELETE CASCADE ON UPDATE CASCADE;
