-- AlterEnum: nuovo registro di numerazione interna
ALTER TYPE "ContatoreFiscaleTipo" ADD VALUE 'GIUSTIFICATIVO_INTERNO';

-- CreateEnum
CREATE TYPE "GiustificativoInternoTipo" AS ENUM ('COSTO_PROMO');

-- CreateTable
CREATE TABLE "giustificativi_interni" (
    "id" UUID NOT NULL,
    "tipo" "GiustificativoInternoTipo" NOT NULL DEFAULT 'COSTO_PROMO',
    "numeroProgressivo" INTEGER NOT NULL,
    "anno" INTEGER NOT NULL,
    "numeroStr" TEXT NOT NULL,
    "importoCent" INTEGER NOT NULL,
    "causale" TEXT NOT NULL,
    "payoutId" UUID NOT NULL,
    "beneficiarioCompanyId" UUID,
    "datiBeneficiario" JSONB NOT NULL,
    "righe" JSONB NOT NULL,
    "emessoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "giustificativi_interni_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "giustificativi_interni_numeroStr_key" ON "giustificativi_interni"("numeroStr");
CREATE UNIQUE INDEX "giustificativi_interni_payoutId_key" ON "giustificativi_interni"("payoutId");
CREATE UNIQUE INDEX "giustificativi_interni_anno_numeroProgressivo_key" ON "giustificativi_interni"("anno", "numeroProgressivo");

-- AddForeignKey
ALTER TABLE "giustificativi_interni" ADD CONSTRAINT "giustificativi_interni_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "giustificativi_interni" ADD CONSTRAINT "giustificativi_interni_beneficiarioCompanyId_fkey" FOREIGN KEY ("beneficiarioCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
