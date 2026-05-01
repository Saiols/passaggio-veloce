-- CreateTable
CREATE TABLE "referral_clicks" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "referralCode" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "referral_clicks_companyId_createdAt_idx" ON "referral_clicks"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "referral_clicks_referralCode_idx" ON "referral_clicks"("referralCode");

-- AddForeignKey
ALTER TABLE "referral_clicks" ADD CONSTRAINT "referral_clicks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
