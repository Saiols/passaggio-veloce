-- CreateEnum
CREATE TYPE "RegimeFiscale" AS ENUM ('ORDINARIO', 'FORFETTARIO', 'PRIVATO');

-- CreateEnum
CREATE TYPE "DocumentoFiscaleTipo" AS ENUM ('FATTURA_PV', 'DOC_BROKER', 'PENALE_BROKER', 'NOTA_VARIAZIONE');

-- CreateEnum
CREATE TYPE "FatturaPaTipo" AS ENUM ('TD01', 'TD06', 'TD04', 'TD05');

-- CreateEnum
CREATE TYPE "DocumentoFiscaleStatoPagamento" AS ENUM ('IN_ATTESA', 'PAGATA', 'SCADUTA', 'STORNATA');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "numeratoreFiscaleAnno" INTEGER,
ADD COLUMN     "numeratoreFiscaleNum" INTEGER,
ADD COLUMN     "regimeFiscale" "RegimeFiscale" NOT NULL DEFAULT 'ORDINARIO';

-- CreateTable
CREATE TABLE "documenti_fiscali" (
    "id" UUID NOT NULL,
    "tipo" "DocumentoFiscaleTipo" NOT NULL,
    "fatturaPaTipo" "FatturaPaTipo",
    "praticaId" UUID,
    "payoutId" UUID,
    "emittenteCompanyId" UUID,
    "destinatarioCompanyId" UUID NOT NULL,
    "datiEmittente" JSONB NOT NULL,
    "datiDestinatario" JSONB NOT NULL,
    "numeroProgressivo" INTEGER NOT NULL,
    "anno" INTEGER NOT NULL,
    "importoLordoCent" INTEGER NOT NULL,
    "imponibileCent" INTEGER,
    "ivaCent" INTEGER,
    "aliquotaIvaPct" INTEGER,
    "ritenutaAccontoCent" INTEGER,
    "statoPagamento" "DocumentoFiscaleStatoPagamento" NOT NULL DEFAULT 'IN_ATTESA',
    "trasmessoSdiAt" TIMESTAMP(3),
    "trasmessoSdiBy" UUID,
    "pdfStorageKey" TEXT,
    "xmlStorageKey" TEXT,
    "pdfHash" TEXT,
    "feeAddebitoId" UUID,
    "transazioneWalletId" UUID,
    "notaVariazionePerId" UUID,
    "emessoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviatoEmailAt" TIMESTAMP(3),

    CONSTRAINT "documenti_fiscali_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documenti_fiscali_payoutId_key" ON "documenti_fiscali"("payoutId");

-- CreateIndex
CREATE UNIQUE INDEX "documenti_fiscali_transazioneWalletId_key" ON "documenti_fiscali"("transazioneWalletId");

-- CreateIndex
CREATE INDEX "documenti_fiscali_praticaId_idx" ON "documenti_fiscali"("praticaId");

-- CreateIndex
CREATE INDEX "documenti_fiscali_payoutId_idx" ON "documenti_fiscali"("payoutId");

-- CreateIndex
CREATE INDEX "documenti_fiscali_destinatarioCompanyId_statoPagamento_idx" ON "documenti_fiscali"("destinatarioCompanyId", "statoPagamento");

-- CreateIndex
CREATE INDEX "documenti_fiscali_emittenteCompanyId_anno_idx" ON "documenti_fiscali"("emittenteCompanyId", "anno");

-- CreateIndex
CREATE INDEX "documenti_fiscali_emessoAt_idx" ON "documenti_fiscali"("emessoAt");

-- CreateIndex
CREATE UNIQUE INDEX "documenti_fiscali_emittenteCompanyId_anno_numeroProgressivo_key" ON "documenti_fiscali"("emittenteCompanyId", "anno", "numeroProgressivo", "tipo");

-- AddForeignKey
ALTER TABLE "documenti_fiscali" ADD CONSTRAINT "documenti_fiscali_praticaId_fkey" FOREIGN KEY ("praticaId") REFERENCES "pratiche"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documenti_fiscali" ADD CONSTRAINT "documenti_fiscali_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documenti_fiscali" ADD CONSTRAINT "documenti_fiscali_emittenteCompanyId_fkey" FOREIGN KEY ("emittenteCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documenti_fiscali" ADD CONSTRAINT "documenti_fiscali_destinatarioCompanyId_fkey" FOREIGN KEY ("destinatarioCompanyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documenti_fiscali" ADD CONSTRAINT "documenti_fiscali_notaVariazionePerId_fkey" FOREIGN KEY ("notaVariazionePerId") REFERENCES "documenti_fiscali"("id") ON DELETE SET NULL ON UPDATE CASCADE;
