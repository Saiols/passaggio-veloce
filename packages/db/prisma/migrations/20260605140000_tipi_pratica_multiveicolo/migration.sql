-- Tipi pratica SEMPLICE/MINIVOLTURA + modello Veicolo (n veicoli per pratica).

-- 1. Rename enum (le righe esistenti riflettono il nuovo label automaticamente)
ALTER TYPE "PraticaTipo" RENAME VALUE 'PASSAGGIO_PRIVATO' TO 'SEMPLICE';
ALTER TYPE "PraticaTipo" RENAME VALUE 'MINIVOLTURE_MULTIPLE' TO 'MINIVOLTURA';

-- 2. Tabella veicoli
CREATE TABLE "veicoli" (
    "id" UUID NOT NULL,
    "praticaId" UUID NOT NULL,
    "ordine" INTEGER NOT NULL,
    "targa" TEXT,
    "telaio" TEXT,
    "proprietarioAttuale" TEXT,
    "dataImmatricolazione" TIMESTAMP(3),
    "preImm2015" BOOLEAN NOT NULL DEFAULT false,
    "flagComodatoDuso" BOOLEAN NOT NULL DEFAULT false,
    "ocrData" JSONB,
    "ocrProvider" TEXT,
    "ocrAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "veicoli_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "veicoli_praticaId_idx" ON "veicoli"("praticaId");
ALTER TABLE "veicoli" ADD CONSTRAINT "veicoli_praticaId_fkey" FOREIGN KEY ("praticaId") REFERENCES "pratiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. documenti.veicoloId
ALTER TABLE "documenti" ADD COLUMN "veicoloId" UUID;
CREATE INDEX "documenti_veicoloId_idx" ON "documenti"("veicoloId");
ALTER TABLE "documenti" ADD CONSTRAINT "documenti_veicoloId_fkey" FOREIGN KEY ("veicoloId") REFERENCES "veicoli"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Backfill: 1 veicolo per pratica dai campi denormalizzati
INSERT INTO "veicoli" ("id","praticaId","ordine","targa","telaio","proprietarioAttuale","dataImmatricolazione","preImm2015","flagComodatoDuso","createdAt","updatedAt")
SELECT gen_random_uuid(), p."id", 1, p."targa", p."telaio", p."proprietarioAttuale", p."dataImmatricolazione", p."preImm2015", p."flagComodatoDuso", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "pratiche" p;

-- 5. Collega il libretto esistente di ogni pratica al suo veicolo
UPDATE "documenti" d SET "veicoloId" = v."id"
FROM "veicoli" v
WHERE v."praticaId" = d."praticaId" AND d."tipo" = 'LIBRETTO_CIRCOLAZIONE';

-- 6. Droppa le colonne veicolo denormalizzate da pratiche
ALTER TABLE "pratiche"
  DROP COLUMN "targa",
  DROP COLUMN "telaio",
  DROP COLUMN "proprietarioAttuale",
  DROP COLUMN "dataImmatricolazione",
  DROP COLUMN "preImm2015",
  DROP COLUMN "flagComodatoDuso";
