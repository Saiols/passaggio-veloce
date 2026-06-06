-- Co-intestatari: N venditori per pratica.
CREATE TABLE "venditori" (
  "id" UUID NOT NULL, "praticaId" UUID NOT NULL, "ordine" INTEGER NOT NULL,
  "nome" TEXT, "cognome" TEXT, "cf" TEXT,
  "isPersonaGiuridica" BOOLEAN NOT NULL DEFAULT false,
  "ragioneSociale" TEXT, "piva" TEXT, "telefono" TEXT, "email" TEXT,
  "tipoSoggetto" "TipoSoggetto", "visuraData" DATE, "permessoData" DATE,
  "documentoIdentita" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "venditori_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "venditori_praticaId_idx" ON "venditori"("praticaId");
ALTER TABLE "venditori" ADD CONSTRAINT "venditori_praticaId_fkey" FOREIGN KEY ("praticaId") REFERENCES "pratiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documenti" ADD COLUMN "venditoreId" UUID;
CREATE INDEX "documenti_venditoreId_idx" ON "documenti"("venditoreId");
ALTER TABLE "documenti" ADD CONSTRAINT "documenti_venditoreId_fkey" FOREIGN KEY ("venditoreId") REFERENCES "venditori"("id") ON DELETE SET NULL ON UPDATE CASCADE;
INSERT INTO "venditori" ("id","praticaId","ordine","nome","cognome","cf","isPersonaGiuridica","ragioneSociale","piva","telefono","email","tipoSoggetto","visuraData","permessoData","createdAt","updatedAt")
SELECT gen_random_uuid(), p."id", 1, p."venditoreNome", p."venditoreCognome", p."venditoreCF", p."venditoreIsPersonaGiuridica", p."venditoreRagioneSociale", p."venditorePIVA", p."venditoreTelefono", p."venditoreEmail", p."venditoreTipoSoggetto", p."venditoreVisuraData", p."venditorePermessoData", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "pratiche" p;
UPDATE "documenti" d SET "venditoreId" = v."id" FROM "venditori" v WHERE v."praticaId" = d."praticaId" AND d."owner" = 'VENDITORE';
ALTER TABLE "pratiche"
  DROP COLUMN "venditoreNome", DROP COLUMN "venditoreCognome", DROP COLUMN "venditoreCF",
  DROP COLUMN "venditoreIsPersonaGiuridica", DROP COLUMN "venditoreRagioneSociale", DROP COLUMN "venditorePIVA",
  DROP COLUMN "venditoreTelefono", DROP COLUMN "venditoreEmail", DROP COLUMN "venditoreTipoSoggetto",
  DROP COLUMN "venditoreVisuraData", DROP COLUMN "venditorePermessoData";
