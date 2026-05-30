ALTER TYPE "CommissioneAffiliazioneStato" ADD VALUE IF NOT EXISTS 'DA_REVISIONARE';
ALTER TYPE "NotificaTipo" ADD VALUE IF NOT EXISTS 'N22_REFERRAL_SIGNUP';
ALTER TYPE "NotificaTipo" ADD VALUE IF NOT EXISTS 'N23_REFERRAL_FIRST_PRATICA';
ALTER TYPE "NotificaTipo" ADD VALUE IF NOT EXISTS 'N24_PAYOUT_AFFILIATION_AVAILABLE';
ALTER TYPE "NotificaTipo" ADD VALUE IF NOT EXISTS 'N25_MONTHLY_AFFILIATION_RECAP';

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "signupIp" TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "suspensionLastNote" TEXT;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "twoFactorBackupCodes" JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "twoFactorSecret" TEXT;

ALTER TABLE "commissioni_affiliazione" ADD COLUMN IF NOT EXISTS "flagsDetected" TEXT;
ALTER TABLE "commissioni_affiliazione" ADD COLUMN IF NOT EXISTS "reviewNotes" TEXT;
ALTER TABLE "commissioni_affiliazione" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "commissioni_affiliazione" ADD COLUMN IF NOT EXISTS "reviewedById" UUID;

CREATE INDEX IF NOT EXISTS "commissioni_affiliazione_stato_idx" ON "commissioni_affiliazione"("stato");

DO $$ BEGIN
  ALTER TABLE "commissioni_affiliazione" ADD CONSTRAINT "commissioni_affiliazione_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
