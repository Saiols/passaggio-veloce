-- CreateTable
CREATE TABLE "tariffe_piattaforma" (
    "id" UUID NOT NULL,
    "sempliceFeeAgenziaCent" INTEGER NOT NULL,
    "sempliceCreditoBrokerCent" INTEGER NOT NULL,
    "sempliceAffiliazioneCent" INTEGER NOT NULL,
    "minivolturaFeeAgenziaCent" INTEGER NOT NULL,
    "minivolturaCreditoBrokerCent" INTEGER NOT NULL,
    "minivolturaAffiliazioneCent" INTEGER NOT NULL,
    "attivo" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "tariffe_piattaforma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tariffe_piattaforma_attivo_idx" ON "tariffe_piattaforma"("attivo");

-- CreateIndex
CREATE INDEX "tariffe_piattaforma_createdAt_idx" ON "tariffe_piattaforma"("createdAt");

-- AddForeignKey
ALTER TABLE "tariffe_piattaforma" ADD CONSTRAINT "tariffe_piattaforma_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed listino attivo con i valori legacy (idempotente: solo se la tabella è vuota).
INSERT INTO "tariffe_piattaforma" (
    "id",
    "sempliceFeeAgenziaCent", "sempliceCreditoBrokerCent", "sempliceAffiliazioneCent",
    "minivolturaFeeAgenziaCent", "minivolturaCreditoBrokerCent", "minivolturaAffiliazioneCent",
    "attivo"
)
SELECT
    gen_random_uuid(),
    7500, 2500, 1000,
    1500, 0, 500,
    true
WHERE NOT EXISTS (SELECT 1 FROM "tariffe_piattaforma");
