-- AlterTable
ALTER TABLE "users" ADD COLUMN "mandatoOtpHash" TEXT;
ALTER TABLE "users" ADD COLUMN "mandatoOtpExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "mandati_fatturazione" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "firmatarioUserId" UUID NOT NULL,
    "firmatoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storageKey" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'local',
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "sizeBytes" INTEGER NOT NULL,
    "datiSnapshot" JSONB NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "otpVerificatoAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mandati_fatturazione_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mandati_fatturazione_companyId_key" ON "mandati_fatturazione"("companyId");

-- AddForeignKey
ALTER TABLE "mandati_fatturazione" ADD CONSTRAINT "mandati_fatturazione_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mandati_fatturazione" ADD CONSTRAINT "mandati_fatturazione_firmatarioUserId_fkey" FOREIGN KEY ("firmatarioUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
