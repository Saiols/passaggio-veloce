-- AlterEnum
ALTER TYPE "CommissioneAffiliazioneStato" ADD VALUE 'DA_REVISIONARE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificaTipo" ADD VALUE 'N22_REFERRAL_SIGNUP';
ALTER TYPE "NotificaTipo" ADD VALUE 'N23_REFERRAL_FIRST_PRATICA';
ALTER TYPE "NotificaTipo" ADD VALUE 'N24_PAYOUT_AFFILIATION_AVAILABLE';
ALTER TYPE "NotificaTipo" ADD VALUE 'N25_MONTHLY_AFFILIATION_RECAP';

-- DropForeignKey
ALTER TABLE "broker_dichiarazioni" DROP CONSTRAINT "broker_dichiarazioni_userId_fkey";

-- DropForeignKey
ALTER TABLE "crm_campaigns" DROP CONSTRAINT "crm_campaigns_agentId_fkey";

-- DropForeignKey
ALTER TABLE "crm_campaigns" DROP CONSTRAINT "crm_campaigns_ownerId_fkey";

-- AlterTable
ALTER TABLE "commissioni_affiliazione" ADD COLUMN     "flagsDetected" TEXT,
ADD COLUMN     "reviewNotes" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" UUID;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "signupIp" TEXT,
ADD COLUMN     "suspensionLastNote" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "twoFactorBackupCodes" JSONB,
ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoFactorSecret" TEXT;

-- CreateIndex
CREATE INDEX "commissioni_affiliazione_stato_idx" ON "commissioni_affiliazione"("stato");

-- AddForeignKey
ALTER TABLE "broker_dichiarazioni" ADD CONSTRAINT "broker_dichiarazioni_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissioni_affiliazione" ADD CONSTRAINT "commissioni_affiliazione_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "crm_sales_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
