-- Distribuzione v2: raggio incrementale + distanza stradale reale.
-- Nota: ALTER TYPE ... ADD VALUE non può essere usata nella stessa
-- transazione in cui il nuovo valore viene poi utilizzato. Questa migration
-- non lo usa (nessun UPDATE/INSERT con IN_DISTRIBUZIONE), quindi può stare
-- come prima statement della stessa migration.
ALTER TYPE "PraticaStato" ADD VALUE IF NOT EXISTS 'IN_DISTRIBUZIONE';

ALTER TABLE "pratiche"
  ADD COLUMN "raggioCorrenteM" INTEGER,
  ADD COLUMN "ultimaEspansioneAt" TIMESTAMP(3),
  ADD COLUMN "zonaNonCopertaAt" TIMESTAMP(3);

ALTER TABLE "pratiche_assegnazioni"
  ADD COLUMN "raggioMetri" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "distribuzione_config" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "raggioStartM" INTEGER NOT NULL DEFAULT 500,
  "stepM" INTEGER NOT NULL DEFAULT 200,
  "raggioMaxM" INTEGER NOT NULL DEFAULT 10000,
  "intervalloMin" INTEGER NOT NULL DEFAULT 10,
  "orarioInizio" TEXT NOT NULL DEFAULT '09:00',
  "orarioFine" TEXT NOT NULL DEFAULT '19:00',
  "giorni" TEXT NOT NULL DEFAULT 'LUN,MAR,MER,GIO,VEN',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "distribuzione_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "road_distance_cache" (
  "id" UUID NOT NULL,
  "praticaId" UUID NOT NULL,
  "sedeId" UUID NOT NULL,
  "distanzaM" INTEGER NOT NULL,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "road_distance_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "road_distance_cache_praticaId_sedeId_key" ON "road_distance_cache"("praticaId","sedeId");
CREATE INDEX "road_distance_cache_praticaId_idx" ON "road_distance_cache"("praticaId");

INSERT INTO "distribuzione_config" ("id","updatedAt") VALUES ('singleton', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
