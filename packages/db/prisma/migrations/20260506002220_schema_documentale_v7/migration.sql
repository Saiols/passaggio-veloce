-- Schema Documentale v7 — SD-A release 2026-05
-- (vedi docs/schema-documentale-v7.md)

-- AlterEnum: nuovi DocumentoTipo per casistiche speciali (comodato, successione, minore)
ALTER TYPE "DocumentoTipo" ADD VALUE 'REVOCA_COMODATO';
ALTER TYPE "DocumentoTipo" ADD VALUE 'CERTIFICATO_MORTE';
ALTER TYPE "DocumentoTipo" ADD VALUE 'ATTO_ACCETTAZIONE_EREDITA';
ALTER TYPE "DocumentoTipo" ADD VALUE 'DICHIARAZIONE_QUALITA_EREDE';
ALTER TYPE "DocumentoTipo" ADD VALUE 'AUTORIZZAZIONE_TUTORE';

-- AlterEnum: nuove notifiche per revisione manuale
ALTER TYPE "NotificaTipo" ADD VALUE 'N20_ADMIN_REVISIONE_RICHIESTA';
ALTER TYPE "NotificaTipo" ADD VALUE 'N21_BROKER_REVISIONE_COMPLETATA';

-- CreateEnum: tipologia di soggetto venditore/acquirente
CREATE TYPE "TipoSoggetto" AS ENUM (
  'PRIVATO_ITALIANO_CIE',
  'PRIVATO_ITALIANO_CARTACEA',
  'STRANIERO_EXTRA_UE',
  'AZIENDA',
  'OPERATORE_AUTO'
);

-- CreateEnum: motivo revisione manuale (caso non riconosciuto)
CREATE TYPE "MotivoRevisioneManuale" AS ENUM (
  'DOCUMENTO_NON_STANDARD',
  'CASO_NON_PREVISTO_DA_SCHEMA',
  'RICHIESTA_BROKER'
);

-- AlterTable: variabili albero decisionale + revisione manuale
ALTER TABLE "pratiche"
  ADD COLUMN "venditoreTipoSoggetto"    "TipoSoggetto",
  ADD COLUMN "venditoreVisuraData"      DATE,
  ADD COLUMN "venditorePermessoData"    DATE,
  ADD COLUMN "acquirenteTipoSoggetto"   "TipoSoggetto",
  ADD COLUMN "acquirenteVisuraData"     DATE,
  ADD COLUMN "acquirentePermessoData"   DATE,
  ADD COLUMN "flagSuccessione"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "flagMinore"               BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "richiedeRevisioneManuale" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "motivoRevisione"          "MotivoRevisioneManuale",
  ADD COLUMN "noteRevisione"            TEXT,
  ADD COLUMN "revisioneCompletata"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "revisioneCompletataAt"    TIMESTAMP(3),
  ADD COLUMN "revisioneCompletataDaId"  UUID;

-- CreateIndex: lookup veloce delle pratiche in revisione manuale
CREATE INDEX "pratiche_richiedeRevisioneManuale_idx" ON "pratiche"("richiedeRevisioneManuale");
