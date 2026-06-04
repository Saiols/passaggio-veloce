-- Codici promozionali: codici riscattabili in registrazione con accredito sul wallet.

-- AlterEnum
ALTER TYPE "TransazioneWalletTipo" ADD VALUE 'CREDITO_PROMO';

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "amountCent" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_code_redemptions" (
    "id" UUID NOT NULL,
    "promoCodeId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "amountCent" INTEGER NOT NULL,
    "transazioneWalletId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_code_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE INDEX "promo_code_redemptions_promoCodeId_idx" ON "promo_code_redemptions"("promoCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "promo_code_redemptions_promoCodeId_companyId_key" ON "promo_code_redemptions"("promoCodeId", "companyId");

-- AddForeignKey
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
