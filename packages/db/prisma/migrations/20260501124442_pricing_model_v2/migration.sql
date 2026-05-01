-- CreateEnum
CREATE TYPE "CommissioneAffiliazioneTipo" AS ENUM ('REFERENTE_BROKER', 'REFERENTE_AGENZIA');

-- CreateEnum
CREATE TYPE "CommissioneAffiliazioneStato" AS ENUM ('MATURATA', 'ACCREDITATA', 'ANNULLATA');

-- AlterEnum
BEGIN;
CREATE TYPE "PraticaTipo_new" AS ENUM ('PASSAGGIO_PRIVATO', 'MINIVOLTURE_MULTIPLE');
ALTER TABLE "pratiche" ALTER COLUMN "tipo" TYPE "PraticaTipo_new" USING ("tipo"::text::"PraticaTipo_new");
ALTER TYPE "PraticaTipo" RENAME TO "PraticaTipo_old";
ALTER TYPE "PraticaTipo_new" RENAME TO "PraticaTipo";
DROP TYPE "PraticaTipo_old";
COMMIT;

-- AlterTable
ALTER TABLE "pratiche" ADD COLUMN     "numeroVeicoli" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "commissioni_affiliazione" (
    "id" UUID NOT NULL,
    "praticaId" UUID NOT NULL,
    "referenteId" UUID NOT NULL,
    "tipo" "CommissioneAffiliazioneTipo" NOT NULL,
    "stato" "CommissioneAffiliazioneStato" NOT NULL DEFAULT 'MATURATA',
    "importoLordoCent" INTEGER NOT NULL,
    "importoNettoCent" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "transazioneWalletId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commissioni_affiliazione_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commissioni_affiliazione_transazioneWalletId_key" ON "commissioni_affiliazione"("transazioneWalletId");

-- CreateIndex
CREATE INDEX "commissioni_affiliazione_praticaId_idx" ON "commissioni_affiliazione"("praticaId");

-- CreateIndex
CREATE INDEX "commissioni_affiliazione_referenteId_stato_idx" ON "commissioni_affiliazione"("referenteId", "stato");

-- AddForeignKey
ALTER TABLE "commissioni_affiliazione" ADD CONSTRAINT "commissioni_affiliazione_praticaId_fkey" FOREIGN KEY ("praticaId") REFERENCES "pratiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissioni_affiliazione" ADD CONSTRAINT "commissioni_affiliazione_referenteId_fkey" FOREIGN KEY ("referenteId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissioni_affiliazione" ADD CONSTRAINT "commissioni_affiliazione_transazioneWalletId_fkey" FOREIGN KEY ("transazioneWalletId") REFERENCES "transazioni_wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
