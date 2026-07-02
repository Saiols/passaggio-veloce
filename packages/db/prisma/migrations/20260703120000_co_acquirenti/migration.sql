-- AlterTable
ALTER TABLE "documenti" ADD COLUMN     "coAcquirenteId" UUID;

-- CreateTable
CREATE TABLE "co_acquirenti" (
    "id" UUID NOT NULL,
    "praticaId" UUID NOT NULL,
    "ordine" INTEGER NOT NULL,
    "nome" TEXT,
    "cognome" TEXT,
    "cf" TEXT,
    "isPersonaGiuridica" BOOLEAN NOT NULL DEFAULT false,
    "ragioneSociale" TEXT,
    "piva" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "tipoSoggetto" "TipoSoggetto",
    "visuraData" DATE,
    "permessoData" DATE,
    "documentoIdentita" TEXT,
    "indirizzoResidenza" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "co_acquirenti_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "co_acquirenti_praticaId_idx" ON "co_acquirenti"("praticaId");

-- CreateIndex
CREATE INDEX "documenti_coAcquirenteId_idx" ON "documenti"("coAcquirenteId");

-- AddForeignKey
ALTER TABLE "documenti" ADD CONSTRAINT "documenti_coAcquirenteId_fkey" FOREIGN KEY ("coAcquirenteId") REFERENCES "co_acquirenti"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "co_acquirenti" ADD CONSTRAINT "co_acquirenti_praticaId_fkey" FOREIGN KEY ("praticaId") REFERENCES "pratiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;
