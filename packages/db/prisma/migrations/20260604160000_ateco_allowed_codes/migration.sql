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

-- Seed allowlist ATECO di default (gruppo 45 = commercio autoveicoli per i dealer;
-- 82.11/82.99 provvisori per le agenzie, DA CONFERMARE col commercialista).
-- Idempotente: ON CONFLICT non duplica se i codici esistono gia'. Senza questo
-- seed, in produzione l'allowlist sarebbe vuota e bloccherebbe ogni registrazione.
INSERT INTO "ateco_allowed_codes" ("id", "companyType", "code", "label", "active", "createdAt") VALUES
  (gen_random_uuid(), 'DEALER', '4511', 'Commercio autoveicoli', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'DEALER', '4519', 'Commercio altri autoveicoli', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'DEALER', '453', 'Commercio parti e accessori', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'DEALER', '454', 'Commercio motocicli', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'AGENZIA', '8211', 'Servizi integrati di supporto (DA CONFERMARE)', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'AGENZIA', '8299', 'Altri servizi di supporto alle imprese (DA CONFERMARE)', true, CURRENT_TIMESTAMP)
ON CONFLICT ("companyType", "code") DO NOTHING;
