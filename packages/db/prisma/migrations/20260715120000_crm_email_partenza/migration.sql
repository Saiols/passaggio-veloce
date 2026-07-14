-- AlterEnum
ALTER TYPE "NotificaTipo" ADD VALUE 'N26_EMAIL_PARTENZA';

-- AlterTable
ALTER TABLE "crm_contacts"
  ADD COLUMN "invitoToken" TEXT,
  ADD COLUMN "emailUnsubToken" TEXT,
  ADD COLUMN "emailOptOutAt" TIMESTAMP(3),
  ADD COLUMN "promoCodeInviatoId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "crm_contacts_invitoToken_key" ON "crm_contacts"("invitoToken");

-- CreateIndex
CREATE UNIQUE INDEX "crm_contacts_emailUnsubToken_key" ON "crm_contacts"("emailUnsubToken");

-- CreateIndex
CREATE INDEX "crm_contacts_promoCodeInviatoId_idx" ON "crm_contacts"("promoCodeInviatoId");

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_promoCodeInviatoId_fkey" FOREIGN KEY ("promoCodeInviatoId") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
