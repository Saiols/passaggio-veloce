-- Completamenti locali (P1-P5): UTM attribution, 2FA notifiche N31, opt-out notifiche.
-- Migrazione additiva e non distruttiva: nuovi valori enum + colonne nullable.

-- AlterEnum
ALTER TYPE "NotificaStato" ADD VALUE 'SKIPPED';

-- AlterEnum
ALTER TYPE "NotificaTipo" ADD VALUE 'N31_VALUTA_AGENZIA';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "utmContent" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmSource" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notifPrefs" JSONB,
ADD COLUMN     "unsubscribeToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_unsubscribeToken_key" ON "users"("unsubscribeToken");
