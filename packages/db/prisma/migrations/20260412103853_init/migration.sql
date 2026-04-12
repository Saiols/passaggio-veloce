-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('DEALER', 'AGENZIA');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN_AZIENDA', 'UTENTE_AZIENDA', 'ADMIN_PIATTAFORMA');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "type" "CompanyType" NOT NULL,
    "ragioneSociale" TEXT NOT NULL,
    "partitaIva" TEXT NOT NULL,
    "codiceSdi" TEXT,
    "pec" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" TEXT,
    "indirizzo" TEXT NOT NULL,
    "citta" TEXT NOT NULL,
    "cap" TEXT NOT NULL,
    "provincia" TEXT NOT NULL,
    "iban" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "nome" TEXT NOT NULL,
    "cognome" TEXT NOT NULL,
    "codiceFiscale" TEXT,
    "dataNascita" TIMESTAMP(3),
    "luogoNascita" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'UTENTE_AZIENDA',
    "companyId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_partitaIva_key" ON "companies"("partitaIva");

-- CreateIndex
CREATE INDEX "companies_type_idx" ON "companies"("type");

-- CreateIndex
CREATE INDEX "companies_citta_idx" ON "companies"("citta");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_companyId_idx" ON "users"("companyId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
