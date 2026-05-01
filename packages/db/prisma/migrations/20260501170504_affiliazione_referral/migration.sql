-- AlterEnum
ALTER TYPE "TransazioneWalletTipo" ADD VALUE 'CREDITO_AFFILIAZIONE';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN "referenteId" UUID;
ALTER TABLE "companies" ADD COLUMN "referralCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "companies_referralCode_key" ON "companies"("referralCode");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_referenteId_fkey" FOREIGN KEY ("referenteId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: genera referralCode per tutte le Company esistenti (8 char base36 random).
UPDATE "companies" SET "referralCode" = LPAD(LOWER(SUBSTRING(MD5(RANDOM()::text || id::text), 1, 8)), 8, '0') WHERE "referralCode" IS NULL;
