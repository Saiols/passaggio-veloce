-- Migration: numerazione_paper
-- Spec: docs/PassaggioVeloce NumerazioneFatture.docx
-- Task 1 di 6: schema + contatori fiscali + numeroSoggetto + numeroDocumentoStr

-- 1) Sequence per numeroSoggetto (univoco, mai riusato)
CREATE SEQUENCE IF NOT EXISTS numero_soggetto_seq START 1;

-- 2) Colonna numeroSoggetto (nullable in transitorio, poi backfill, poi NOT NULL)
ALTER TABLE "companies" ADD COLUMN "numeroSoggetto" INTEGER;

WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt", id) AS rn FROM "companies"
)
UPDATE "companies" c SET "numeroSoggetto" = o.rn FROM ordered o WHERE c.id = o.id;

SELECT setval('numero_soggetto_seq', (SELECT COALESCE(MAX("numeroSoggetto"), 0) FROM "companies"), true);

ALTER TABLE "companies" ALTER COLUMN "numeroSoggetto" SET DEFAULT nextval('numero_soggetto_seq');
ALTER TABLE "companies" ALTER COLUMN "numeroSoggetto" SET NOT NULL;
CREATE UNIQUE INDEX "companies_numeroSoggetto_key" ON "companies"("numeroSoggetto");

-- 3) numeroDocumentoStr su documenti_fiscali
ALTER TABLE "documenti_fiscali" ADD COLUMN "numeroDocumentoStr" TEXT;
CREATE UNIQUE INDEX "documenti_fiscali_numeroDocumentoStr_key" ON "documenti_fiscali"("numeroDocumentoStr");

-- 4) Enum + tabella contatori
CREATE TYPE "ContatoreFiscaleTipo" AS ENUM ('FATTURA_PV', 'DOC_BROKER', 'NOTA_CREDITO', 'PENALE');
CREATE TABLE "contatori_fiscali" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "idSoggetto"    TEXT NOT NULL,
  "tipoDocumento" "ContatoreFiscaleTipo" NOT NULL,
  "anno"          INTEGER NOT NULL,
  "contatore"     INTEGER NOT NULL DEFAULT 0,
  "aggiornatoAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contatori_fiscali_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contatori_fiscali_idSoggetto_tipoDocumento_anno_key"
  ON "contatori_fiscali"("idSoggetto", "tipoDocumento", "anno");

-- 5) Seed contatori broker (DOC_BROKER) dal vecchio stato Company.numeratoreFiscale*
INSERT INTO "contatori_fiscali" ("id","idSoggetto","tipoDocumento","anno","contatore","aggiornatoAt")
SELECT gen_random_uuid(), c.id::text, 'DOC_BROKER', c."numeratoreFiscaleAnno", c."numeratoreFiscaleNum", now()
FROM "companies" c
WHERE c."numeratoreFiscaleAnno" IS NOT NULL AND c."numeratoreFiscaleNum" IS NOT NULL;

-- 6) Seed contatori PV (FATTURA_PV e NOTA_CREDITO) dal max progressivo già usato
--    Si parte dal max tra TUTTI i doc PV dell'anno per evitare collisioni con
--    la vecchia sequenza interlacciata (fatture+note nello stesso registro).
INSERT INTO "contatori_fiscali" ("id","idSoggetto","tipoDocumento","anno","contatore","aggiornatoAt")
SELECT gen_random_uuid(), 'PV', t.tipo, d."anno", MAX(d."numeroProgressivo"), now()
FROM "documenti_fiscali" d
CROSS JOIN (VALUES ('FATTURA_PV'::"ContatoreFiscaleTipo"), ('NOTA_CREDITO'::"ContatoreFiscaleTipo")) AS t(tipo)
WHERE d."emittenteCompanyId" IS NULL
GROUP BY t.tipo, d."anno";

-- 7) Backfill numeroDocumentoStr sui documenti esistenti (formato nuovo, progressivo storico)
UPDATE "documenti_fiscali" d SET "numeroDocumentoStr" =
  CASE
    WHEN d."tipo" = 'FATTURA_PV'   THEN 'PV-' || d."anno" || '-' || lpad(d."numeroProgressivo"::text, 5, '0')
    WHEN d."tipo" = 'PENALE_BROKER' THEN 'PN-' || d."anno" || '-' || lpad(d."numeroProgressivo"::text, 5, '0')
    WHEN d."emittenteCompanyId" IS NULL AND d."tipo" = 'NOTA_VARIAZIONE'
      THEN 'NC-' || d."anno" || '-' || lpad(d."numeroProgressivo"::text, 5, '0')
    WHEN d."tipo" = 'DOC_BROKER'
      THEN 'PV-' || lpad(em."numeroSoggetto"::text, 4, '0') || '-' || d."anno" || '-' || lpad(d."numeroProgressivo"::text, 5, '0')
    WHEN d."tipo" = 'NOTA_VARIAZIONE'
      THEN 'NC-' || lpad(em."numeroSoggetto"::text, 4, '0') || '-' || d."anno" || '-' || lpad(d."numeroProgressivo"::text, 5, '0')
  END
FROM "companies" em WHERE em.id = d."emittenteCompanyId" OR d."emittenteCompanyId" IS NULL;

-- 8) Rimozione vecchie colonne (sostituite da contatori_fiscali)
ALTER TABLE "companies" DROP COLUMN "numeratoreFiscaleAnno";
ALTER TABLE "companies" DROP COLUMN "numeratoreFiscaleNum";
