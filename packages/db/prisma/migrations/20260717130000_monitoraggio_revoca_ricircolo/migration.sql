-- AlterEnum
ALTER TYPE "AssegnazioneEsito" ADD VALUE 'REVOCATA_ADMIN';

-- AlterEnum
ALTER TYPE "NotificaTipo" ADD VALUE 'N50_AGENZIA_PRATICA_REVOCATA';
ALTER TYPE "NotificaTipo" ADD VALUE 'N51_BROKER_PRATICA_RIMESSA_IN_CIRCOLO';

-- AlterTable
ALTER TABLE "pratiche" ADD COLUMN "distribuzioneCiclo" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "pratiche_assegnazioni" ADD COLUMN "ciclo" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "pratica_stato_log" (
    "id" UUID NOT NULL,
    "praticaId" UUID NOT NULL,
    "statoDa" "PraticaStato",
    "statoA" "PraticaStato" NOT NULL,
    "motivo" TEXT,
    "attoreUserId" UUID,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pratica_stato_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pratica_stato_log_praticaId_createdAt_idx" ON "pratica_stato_log"("praticaId", "createdAt");

-- AddForeignKey
ALTER TABLE "pratica_stato_log" ADD CONSTRAINT "pratica_stato_log_praticaId_fkey" FOREIGN KEY ("praticaId") REFERENCES "pratiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;
