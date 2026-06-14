-- DropForeignKey
ALTER TABLE "documenti_fiscali" DROP CONSTRAINT "documenti_fiscali_destinatarioCompanyId_fkey";

-- AlterTable
ALTER TABLE "documenti_fiscali" ALTER COLUMN "destinatarioCompanyId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "documenti_fiscali" ADD CONSTRAINT "documenti_fiscali_destinatarioCompanyId_fkey" FOREIGN KEY ("destinatarioCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
