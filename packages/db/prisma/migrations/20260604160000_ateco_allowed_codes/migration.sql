-- Allowlist ATECO ammessi per la registrazione (KYC), separati per tipo azienda.

-- CreateTable
CREATE TABLE "ateco_allowed_codes" (
    "id" UUID NOT NULL,
    "companyType" "CompanyType" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ateco_allowed_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ateco_allowed_codes_companyType_code_key" ON "ateco_allowed_codes"("companyType", "code");
