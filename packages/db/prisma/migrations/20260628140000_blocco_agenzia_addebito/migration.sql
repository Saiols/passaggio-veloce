-- AlterTable
ALTER TABLE "companies" ADD COLUMN "bloccoPagamentoAt" TIMESTAMP(3);
ALTER TABLE "companies" ADD COLUMN "bloccoPagamentoMotivo" TEXT;

-- AlterTable
ALTER TABLE "fee_addebiti" ADD COLUMN "tentativi" INTEGER NOT NULL DEFAULT 0;

-- AlterEnum
ALTER TYPE "NotificaTipo" ADD VALUE 'N9_AGENZIA_ADDEBITO_FALLITO';
