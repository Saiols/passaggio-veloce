-- AlterTable: referto tracking CRM
ALTER TABLE "crm_contacts" ADD COLUMN "mailApertaAt" TIMESTAMP(3);
ALTER TABLE "crm_contacts" ADD COLUMN "iscrizioneInitAt" TIMESTAMP(3);
ALTER TABLE "crm_contacts" ADD COLUMN "emailBouncedAt" TIMESTAMP(3);
ALTER TABLE "crm_contacts" ADD COLUMN "emailBounceMotivo" TEXT;

-- AlterTable: correlazione webhook Resend -> contatto CRM
ALTER TABLE "notifiche_inviate" ADD COLUMN "crmContactId" UUID;

-- CreateIndex
CREATE INDEX "notifiche_inviate_crmContactId_idx" ON "notifiche_inviate"("crmContactId");
CREATE INDEX "notifiche_inviate_providerRef_idx" ON "notifiche_inviate"("providerRef");
