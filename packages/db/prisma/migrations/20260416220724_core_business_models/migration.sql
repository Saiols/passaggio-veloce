-- CreateEnum
CREATE TYPE "PraticaTipo" AS ENUM ('TRAPASSO_NETTO', 'MINIVOLTURA', 'LOTTO_MASSIVO');

-- CreateEnum
CREATE TYPE "PraticaStato" AS ENUM ('BOZZA', 'IN_ATTESA_ROUND_1', 'IN_ATTESA_ROUND_2', 'IN_ATTESA_ROUND_3', 'IN_ESCALATION', 'ACCETTATA', 'FIRMATA', 'SCADUTA', 'ANNULLATA');

-- CreateEnum
CREATE TYPE "AssegnazioneEsito" AS ENUM ('PENDING', 'ACCETTATA', 'RIFIUTATA', 'TIMEOUT', 'ASSEGNATA_ALTRO');

-- CreateEnum
CREATE TYPE "DocumentoTipo" AS ENUM ('LIBRETTO_CIRCOLAZIONE', 'CI_FRONTE', 'CI_RETRO', 'CODICE_FISCALE', 'PROCURA', 'PERMESSO_SOGGIORNO', 'VISURA_CAMERALE', 'CERTIFICATO_PROPRIETA', 'ALTRO');

-- CreateEnum
CREATE TYPE "DocumentoOwner" AS ENUM ('VENDITORE', 'ACQUIRENTE', 'AMMINISTRATORE', 'AZIENDA');

-- CreateEnum
CREATE TYPE "OcrStato" AS ENUM ('NONE', 'PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "GatingStato" AS ENUM ('NONE', 'PENDING', 'PASSED', 'FAILED', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "GiornoSettimana" AS ENUM ('LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB', 'DOM');

-- CreateEnum
CREATE TYPE "TransazioneWalletTipo" AS ENUM ('CREDITO_PRATICA', 'PAYOUT_AUTOMATICO', 'PAYOUT_MANUALE', 'RETTIFICA_ADMIN', 'STORNO');

-- CreateEnum
CREATE TYPE "PayoutStato" AS ENUM ('RICHIESTO', 'IN_LAVORAZIONE', 'ESEGUITO', 'FALLITO', 'ANNULLATO');

-- CreateEnum
CREATE TYPE "FeeAddebitoTipo" AS ENUM ('ADDEBITO_FIRMA', 'AUTO_ADDEBITO_GIORNO_20');

-- CreateEnum
CREATE TYPE "FeeAddebitoStato" AS ENUM ('SCHEDULED', 'IN_LAVORAZIONE', 'SUCCESS', 'FAILED', 'RETRY', 'ANNULLATO');

-- CreateEnum
CREATE TYPE "ListinoFormato" AS ENUM ('UPLOAD_FILE', 'FORM_STRUTTURATO');

-- CreateEnum
CREATE TYPE "NotificaTipo" AS ENUM ('N1_BROKER_INVIO_PRATICA', 'N2_BROKER_ACCETTATA', 'N3_BROKER_SOLLECITO', 'N4_BROKER_FIRMA_E_CREDITO', 'N5_BROKER_PAYOUT', 'N6_AGENZIA_NUOVA_PRATICA', 'N7_AGENZIA_PROMEMORIA_COUNTDOWN', 'N8_AGENZIA_ADDEBITO', 'N10_ADMIN_ESCALATION', 'N11_BROKER_ESCALATION');

-- CreateEnum
CREATE TYPE "NotificaCanale" AS ENUM ('EMAIL', 'SMS', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificaStato" AS ENUM ('SCHEDULED', 'SENT', 'FAILED', 'READ');

-- CreateTable
CREATE TABLE "pratiche" (
    "id" UUID NOT NULL,
    "codicePratica" TEXT,
    "tipo" "PraticaTipo" NOT NULL,
    "stato" "PraticaStato" NOT NULL DEFAULT 'BOZZA',
    "targa" TEXT,
    "telaio" TEXT,
    "proprietarioAttuale" TEXT,
    "dataImmatricolazione" TIMESTAMP(3),
    "preImm2015" BOOLEAN NOT NULL DEFAULT false,
    "flagComodatoDuso" BOOLEAN NOT NULL DEFAULT false,
    "venditoreNome" TEXT,
    "venditoreCognome" TEXT,
    "venditoreCF" TEXT,
    "venditoreIsPersonaGiuridica" BOOLEAN NOT NULL DEFAULT false,
    "venditoreRagioneSociale" TEXT,
    "venditorePIVA" TEXT,
    "acquirenteNome" TEXT,
    "acquirenteCognome" TEXT,
    "acquirenteCF" TEXT,
    "acquirenteIsPersonaGiuridica" BOOLEAN NOT NULL DEFAULT false,
    "acquirenteRagioneSociale" TEXT,
    "acquirentePIVA" TEXT,
    "flagCointestazione" BOOLEAN NOT NULL DEFAULT false,
    "flagMinivoltura" BOOLEAN NOT NULL DEFAULT false,
    "flagProcura" BOOLEAN NOT NULL DEFAULT false,
    "comune" TEXT,
    "provincia" TEXT,
    "brokerId" UUID NOT NULL,
    "agenziaAssegnataId" UUID,
    "codiceAgenziaInterno" TEXT,
    "notaInternaAgenzia" TEXT,
    "feeAgenziaCent" INTEGER NOT NULL DEFAULT 0,
    "creditoBrokerCent" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "round1StartedAt" TIMESTAMP(3),
    "round2StartedAt" TIMESTAMP(3),
    "round3StartedAt" TIMESTAMP(3),
    "escalationAt" TIMESTAMP(3),
    "accettataAt" TIMESTAMP(3),
    "firmaAvvenutaAt" TIMESTAMP(3),
    "autoAddebitoAt" TIMESTAMP(3),
    "scadutaAt" TIMESTAMP(3),
    "annullataAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "pratiche_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pratiche_assegnazioni" (
    "id" UUID NOT NULL,
    "praticaId" UUID NOT NULL,
    "agenziaId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "invioAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notificaInviataAt" TIMESTAMP(3),
    "countdownInizioAt" TIMESTAMP(3),
    "countdownFineAt" TIMESTAMP(3),
    "esito" "AssegnazioneEsito" NOT NULL DEFAULT 'PENDING',
    "esitoAt" TIMESTAMP(3),
    "notaRifiuto" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pratiche_assegnazioni_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documenti" (
    "id" UUID NOT NULL,
    "tipo" "DocumentoTipo" NOT NULL,
    "owner" "DocumentoOwner",
    "praticaId" UUID,
    "companyId" UUID,
    "storageKey" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'local',
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "uploadedById" UUID NOT NULL,
    "ocrStato" "OcrStato" NOT NULL DEFAULT 'NONE',
    "ocrProvider" TEXT,
    "ocrData" JSONB,
    "ocrAt" TIMESTAMP(3),
    "ocrError" TEXT,
    "gatingStato" "GatingStato" NOT NULL DEFAULT 'NONE',
    "gatingError" TEXT,
    "gatingOverrideById" UUID,
    "gatingOverrideAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "documenti_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orari_apertura" (
    "id" UUID NOT NULL,
    "agenziaId" UUID NOT NULL,
    "giorno" "GiornoSettimana" NOT NULL,
    "fasceOrarie" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orari_apertura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chiusure_straordinarie" (
    "id" UUID NOT NULL,
    "agenziaId" UUID NOT NULL,
    "dataInizio" DATE NOT NULL,
    "dataFine" DATE NOT NULL,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chiusure_straordinarie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "saldoCent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transazioni_wallet" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "tipo" "TransazioneWalletTipo" NOT NULL,
    "importoCent" INTEGER NOT NULL,
    "saldoPostCent" INTEGER NOT NULL,
    "praticaId" UUID,
    "payoutId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transazioni_wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "importoCent" INTEGER NOT NULL,
    "stato" "PayoutStato" NOT NULL DEFAULT 'RICHIESTO',
    "automatico" BOOLEAN NOT NULL DEFAULT false,
    "richiestoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eseguitoAt" TIMESTAMP(3),
    "fallitoAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "rendicontoStorageKey" TEXT,
    "providerRef" TEXT,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_addebiti" (
    "id" UUID NOT NULL,
    "praticaId" UUID NOT NULL,
    "agenziaId" UUID NOT NULL,
    "importoCent" INTEGER NOT NULL,
    "tipo" "FeeAddebitoTipo" NOT NULL,
    "stato" "FeeAddebitoStato" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_addebiti_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valutazioni" (
    "id" UUID NOT NULL,
    "praticaId" UUID NOT NULL,
    "agenziaId" UUID NOT NULL,
    "dealerId" UUID NOT NULL,
    "stelle" INTEGER NOT NULL,
    "note" TEXT,
    "segnalazioneAbuso" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "valutazioni_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listini" (
    "id" UUID NOT NULL,
    "agenziaId" UUID NOT NULL,
    "formato" "ListinoFormato" NOT NULL,
    "documentoStorageKey" TEXT,
    "prezzoBaseTrapassoCent" INTEGER,
    "prezzoMinivolturaCent" INTEGER,
    "maggiorazioni" JSONB,
    "provincieCopertura" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listini_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifiche_inviate" (
    "id" UUID NOT NULL,
    "tipo" "NotificaTipo" NOT NULL,
    "canale" "NotificaCanale" NOT NULL,
    "stato" "NotificaStato" NOT NULL DEFAULT 'SCHEDULED',
    "userId" UUID,
    "companyId" UUID,
    "destinazione" TEXT NOT NULL,
    "subject" TEXT,
    "bodyPreview" TEXT,
    "payload" JSONB NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "providerRef" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifiche_inviate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pratiche_codicePratica_key" ON "pratiche"("codicePratica");

-- CreateIndex
CREATE INDEX "pratiche_brokerId_idx" ON "pratiche"("brokerId");

-- CreateIndex
CREATE INDEX "pratiche_agenziaAssegnataId_idx" ON "pratiche"("agenziaAssegnataId");

-- CreateIndex
CREATE INDEX "pratiche_stato_idx" ON "pratiche"("stato");

-- CreateIndex
CREATE INDEX "pratiche_provincia_idx" ON "pratiche"("provincia");

-- CreateIndex
CREATE INDEX "pratiche_comune_idx" ON "pratiche"("comune");

-- CreateIndex
CREATE INDEX "pratiche_assegnazioni_agenziaId_esito_idx" ON "pratiche_assegnazioni"("agenziaId", "esito");

-- CreateIndex
CREATE INDEX "pratiche_assegnazioni_round_esito_idx" ON "pratiche_assegnazioni"("round", "esito");

-- CreateIndex
CREATE UNIQUE INDEX "pratiche_assegnazioni_praticaId_agenziaId_round_key" ON "pratiche_assegnazioni"("praticaId", "agenziaId", "round");

-- CreateIndex
CREATE INDEX "documenti_praticaId_idx" ON "documenti"("praticaId");

-- CreateIndex
CREATE INDEX "documenti_companyId_idx" ON "documenti"("companyId");

-- CreateIndex
CREATE INDEX "documenti_tipo_idx" ON "documenti"("tipo");

-- CreateIndex
CREATE INDEX "documenti_gatingStato_idx" ON "documenti"("gatingStato");

-- CreateIndex
CREATE UNIQUE INDEX "orari_apertura_agenziaId_giorno_key" ON "orari_apertura"("agenziaId", "giorno");

-- CreateIndex
CREATE INDEX "chiusure_straordinarie_agenziaId_dataInizio_idx" ON "chiusure_straordinarie"("agenziaId", "dataInizio");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_companyId_key" ON "wallets"("companyId");

-- CreateIndex
CREATE INDEX "transazioni_wallet_walletId_createdAt_idx" ON "transazioni_wallet"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "transazioni_wallet_praticaId_idx" ON "transazioni_wallet"("praticaId");

-- CreateIndex
CREATE INDEX "payouts_walletId_stato_idx" ON "payouts"("walletId", "stato");

-- CreateIndex
CREATE INDEX "fee_addebiti_agenziaId_stato_idx" ON "fee_addebiti"("agenziaId", "stato");

-- CreateIndex
CREATE INDEX "fee_addebiti_praticaId_idx" ON "fee_addebiti"("praticaId");

-- CreateIndex
CREATE INDEX "fee_addebiti_scheduledAt_idx" ON "fee_addebiti"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "valutazioni_praticaId_key" ON "valutazioni"("praticaId");

-- CreateIndex
CREATE INDEX "valutazioni_agenziaId_idx" ON "valutazioni"("agenziaId");

-- CreateIndex
CREATE INDEX "listini_agenziaId_idx" ON "listini"("agenziaId");

-- CreateIndex
CREATE INDEX "notifiche_inviate_tipo_idx" ON "notifiche_inviate"("tipo");

-- CreateIndex
CREATE INDEX "notifiche_inviate_userId_idx" ON "notifiche_inviate"("userId");

-- CreateIndex
CREATE INDEX "notifiche_inviate_companyId_idx" ON "notifiche_inviate"("companyId");

-- CreateIndex
CREATE INDEX "notifiche_inviate_stato_scheduledAt_idx" ON "notifiche_inviate"("stato", "scheduledAt");

-- CreateIndex
CREATE INDEX "companies_provincia_idx" ON "companies"("provincia");

-- AddForeignKey
ALTER TABLE "pratiche" ADD CONSTRAINT "pratiche_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pratiche" ADD CONSTRAINT "pratiche_agenziaAssegnataId_fkey" FOREIGN KEY ("agenziaAssegnataId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pratiche_assegnazioni" ADD CONSTRAINT "pratiche_assegnazioni_praticaId_fkey" FOREIGN KEY ("praticaId") REFERENCES "pratiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pratiche_assegnazioni" ADD CONSTRAINT "pratiche_assegnazioni_agenziaId_fkey" FOREIGN KEY ("agenziaId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documenti" ADD CONSTRAINT "documenti_praticaId_fkey" FOREIGN KEY ("praticaId") REFERENCES "pratiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documenti" ADD CONSTRAINT "documenti_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documenti" ADD CONSTRAINT "documenti_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orari_apertura" ADD CONSTRAINT "orari_apertura_agenziaId_fkey" FOREIGN KEY ("agenziaId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chiusure_straordinarie" ADD CONSTRAINT "chiusure_straordinarie_agenziaId_fkey" FOREIGN KEY ("agenziaId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transazioni_wallet" ADD CONSTRAINT "transazioni_wallet_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transazioni_wallet" ADD CONSTRAINT "transazioni_wallet_praticaId_fkey" FOREIGN KEY ("praticaId") REFERENCES "pratiche"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transazioni_wallet" ADD CONSTRAINT "transazioni_wallet_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_addebiti" ADD CONSTRAINT "fee_addebiti_praticaId_fkey" FOREIGN KEY ("praticaId") REFERENCES "pratiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_addebiti" ADD CONSTRAINT "fee_addebiti_agenziaId_fkey" FOREIGN KEY ("agenziaId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valutazioni" ADD CONSTRAINT "valutazioni_praticaId_fkey" FOREIGN KEY ("praticaId") REFERENCES "pratiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valutazioni" ADD CONSTRAINT "valutazioni_agenziaId_fkey" FOREIGN KEY ("agenziaId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valutazioni" ADD CONSTRAINT "valutazioni_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listini" ADD CONSTRAINT "listini_agenziaId_fkey" FOREIGN KEY ("agenziaId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifiche_inviate" ADD CONSTRAINT "notifiche_inviate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifiche_inviate" ADD CONSTRAINT "notifiche_inviate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
