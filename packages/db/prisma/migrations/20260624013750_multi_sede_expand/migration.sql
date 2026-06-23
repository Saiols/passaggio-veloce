-- CreateEnum
CREATE TYPE "RuoloSede" AS ENUM ('ADMIN_SEDE', 'OPERATORE');

-- AlterTable
ALTER TABLE "chiusure_straordinarie" ADD COLUMN     "sedeId" UUID;

-- AlterTable
ALTER TABLE "commissioni_affiliazione" ADD COLUMN     "referenteSedeId" UUID;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "referenteSedeId" UUID;

-- AlterTable
ALTER TABLE "eventi_pratica" ADD COLUMN     "targetSedeId" UUID;

-- AlterTable
ALTER TABLE "fee_addebiti" ADD COLUMN     "agenziaSedeId" UUID;

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "ruoloSede" "RuoloSede" NOT NULL DEFAULT 'OPERATORE',
ADD COLUMN     "sedeId" UUID;

-- AlterTable
ALTER TABLE "listini" ADD COLUMN     "sedeId" UUID;

-- AlterTable
ALTER TABLE "notifiche_inviate" ADD COLUMN     "sedeId" UUID;

-- AlterTable
ALTER TABLE "orari_apertura" ADD COLUMN     "sedeId" UUID;

-- AlterTable
ALTER TABLE "pratiche" ADD COLUMN     "agenziaSedeId" UUID,
ADD COLUMN     "brokerSedeId" UUID;

-- AlterTable
ALTER TABLE "pratiche_assegnazioni" ADD COLUMN     "sedeId" UUID;

-- AlterTable
ALTER TABLE "referral_clicks" ADD COLUMN     "sedeId" UUID;

-- AlterTable
ALTER TABLE "valutazioni" ADD COLUMN     "agenziaSedeId" UUID,
ADD COLUMN     "brokerSedeId" UUID;

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "sedeId" UUID,
ALTER COLUMN "companyId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "sedi" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "type" "CompanyType" NOT NULL,
    "nome" TEXT NOT NULL,
    "indirizzo" TEXT NOT NULL,
    "civico" TEXT,
    "citta" TEXT NOT NULL,
    "cap" TEXT NOT NULL,
    "provincia" TEXT NOT NULL,
    "telefono" TEXT,
    "email" TEXT,
    "iban" TEXT,
    "payoutThresholdCent" INTEGER NOT NULL DEFAULT 100000,
    "referralCode" TEXT,
    "codiceInterno" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sedi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sedi" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "ruolo" "RuoloSede" NOT NULL DEFAULT 'OPERATORE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sedi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sedi_referralCode_key" ON "sedi"("referralCode");

-- CreateIndex
CREATE INDEX "sedi_companyId_idx" ON "sedi"("companyId");

-- CreateIndex
CREATE INDEX "sedi_type_idx" ON "sedi"("type");

-- CreateIndex
CREATE INDEX "sedi_citta_idx" ON "sedi"("citta");

-- CreateIndex
CREATE INDEX "sedi_provincia_idx" ON "sedi"("provincia");

-- CreateIndex
CREATE INDEX "user_sedi_sedeId_idx" ON "user_sedi"("sedeId");

-- CreateIndex
CREATE INDEX "user_sedi_userId_idx" ON "user_sedi"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_sedi_userId_sedeId_key" ON "user_sedi"("userId", "sedeId");

-- CreateIndex
CREATE INDEX "fee_addebiti_agenziaSedeId_stato_idx" ON "fee_addebiti"("agenziaSedeId", "stato");

-- CreateIndex
CREATE INDEX "pratiche_brokerSedeId_idx" ON "pratiche"("brokerSedeId");

-- CreateIndex
CREATE INDEX "pratiche_agenziaSedeId_idx" ON "pratiche"("agenziaSedeId");

-- CreateIndex
CREATE INDEX "pratiche_assegnazioni_sedeId_esito_idx" ON "pratiche_assegnazioni"("sedeId", "esito");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_sedeId_key" ON "wallets"("sedeId");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_referenteSedeId_fkey" FOREIGN KEY ("referenteSedeId") REFERENCES "sedi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sedi" ADD CONSTRAINT "sedi_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sedi" ADD CONSTRAINT "user_sedi_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sedi" ADD CONSTRAINT "user_sedi_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pratiche" ADD CONSTRAINT "pratiche_brokerSedeId_fkey" FOREIGN KEY ("brokerSedeId") REFERENCES "sedi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pratiche" ADD CONSTRAINT "pratiche_agenziaSedeId_fkey" FOREIGN KEY ("agenziaSedeId") REFERENCES "sedi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pratiche_assegnazioni" ADD CONSTRAINT "pratiche_assegnazioni_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orari_apertura" ADD CONSTRAINT "orari_apertura_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chiusure_straordinarie" ADD CONSTRAINT "chiusure_straordinarie_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_addebiti" ADD CONSTRAINT "fee_addebiti_agenziaSedeId_fkey" FOREIGN KEY ("agenziaSedeId") REFERENCES "sedi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_clicks" ADD CONSTRAINT "referral_clicks_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissioni_affiliazione" ADD CONSTRAINT "commissioni_affiliazione_referenteSedeId_fkey" FOREIGN KEY ("referenteSedeId") REFERENCES "sedi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valutazioni" ADD CONSTRAINT "valutazioni_agenziaSedeId_fkey" FOREIGN KEY ("agenziaSedeId") REFERENCES "sedi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valutazioni" ADD CONSTRAINT "valutazioni_brokerSedeId_fkey" FOREIGN KEY ("brokerSedeId") REFERENCES "sedi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listini" ADD CONSTRAINT "listini_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifiche_inviate" ADD CONSTRAINT "notifiche_inviate_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventi_pratica" ADD CONSTRAINT "eventi_pratica_targetSedeId_fkey" FOREIGN KEY ("targetSedeId") REFERENCES "sedi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- BACKFILL multi-sede: 1 sede per company esistente + re-pointing FK.
-- (fase expand: niente NOT NULL / DROP qui)
-- ============================================================

-- 1) Una Sede "specchio" per ogni Company esistente.
INSERT INTO "sedi" (
  "id","companyId","type","nome","indirizzo","civico","citta","cap","provincia",
  "telefono","email","iban","payoutThresholdCent","referralCode",
  "createdAt","updatedAt","deletedAt"
)
SELECT
  gen_random_uuid(), c."id", c."type", c."ragioneSociale", c."indirizzo", c."civico",
  c."citta", c."cap", c."provincia", c."telefono", c."email", c."iban",
  c."payoutThresholdCent", c."referralCode",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, c."deletedAt"
FROM "companies" c;

-- 2) Pratiche: broker e agenzia → sede (1 sede per company ⇒ join univoco).
UPDATE "pratiche" p SET "brokerSedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = p."brokerId";
UPDATE "pratiche" p SET "agenziaSedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = p."agenziaAssegnataId" AND p."agenziaAssegnataId" IS NOT NULL;

-- 3) Assegnazioni, calendario, listini, valutazioni, fee, referral, eventi.
UPDATE "pratiche_assegnazioni" pa SET "sedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = pa."agenziaId";
UPDATE "orari_apertura" o SET "sedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = o."agenziaId";
UPDATE "chiusure_straordinarie" ch SET "sedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = ch."agenziaId";
UPDATE "listini" l SET "sedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = l."agenziaId";
UPDATE "valutazioni" v SET "agenziaSedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = v."agenziaId";
UPDATE "valutazioni" v SET "brokerSedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = v."dealerId";
UPDATE "fee_addebiti" f SET "agenziaSedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = f."agenziaId";
UPDATE "referral_clicks" rc SET "sedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = rc."companyId";
UPDATE "eventi_pratica" e SET "targetSedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = e."targetCompanyId";

-- 4) Wallet operativo: sposta ownership da company a sede.
UPDATE "wallets" w SET "sedeId" = s."id", "companyId" = NULL
  FROM "sedi" s WHERE s."companyId" = w."companyId";

-- 5) Affiliazione: referenteSede = sede della madre referente.
UPDATE "companies" c SET "referenteSedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = c."referenteId" AND c."referenteId" IS NOT NULL;
UPDATE "commissioni_affiliazione" ca SET "referenteSedeId" = s."id"
  FROM "sedi" s WHERE s."companyId" = ca."referenteId";

-- 6) UserSede: una membership per ogni utente con companyId.
INSERT INTO "user_sedi" ("id","userId","sedeId","ruolo","createdAt")
SELECT
  gen_random_uuid(), u."id", s."id",
  CASE WHEN u."role" = 'ADMIN_AZIENDA' THEN 'ADMIN_SEDE'::"RuoloSede" ELSE 'OPERATORE'::"RuoloSede" END,
  CURRENT_TIMESTAMP
FROM "users" u
JOIN "sedi" s ON s."companyId" = u."companyId"
WHERE u."companyId" IS NOT NULL;
