-- Sistema Penali Broker — SP-A release 2026-05
-- (vedi docs/sistema-penali-broker.md)

-- AlterEnum: nuovo tipo transazione wallet per addebito penale
ALTER TYPE "TransazioneWalletTipo" ADD VALUE 'PENALE_BROKER';

-- AlterEnum: 3 nuove notifiche (lifecycle penale e segnalazione)
ALTER TYPE "NotificaTipo" ADD VALUE 'N17_BROKER_PENALE_ADDEBITATA';
ALTER TYPE "NotificaTipo" ADD VALUE 'N18_AGENZIA_SEGNALAZIONE_CONFERMATA';
ALTER TYPE "NotificaTipo" ADD VALUE 'N19_ADMIN_NUOVA_SEGNALAZIONE';

-- CreateEnum: tipo problema segnalato dall'agenzia
CREATE TYPE "SegnalazionePraticaTipo" AS ENUM (
  'FERMO_AMMINISTRATIVO',
  'IPOTECA',
  'DOCUMENTO_NON_VALIDO',
  'ALTRO'
);

-- CreateEnum: ciclo di vita segnalazione lato admin
CREATE TYPE "SegnalazionePraticaStato" AS ENUM (
  'RICEVUTA',
  'CONFERMATA',
  'RESPINTA'
);

-- AlterTable: campi segnalazione su pratiche
ALTER TABLE "pratiche"
  ADD COLUMN "flagSegnalata"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tipoSegnalazione"       "SegnalazionePraticaTipo",
  ADD COLUMN "notaSegnalazione"       TEXT,
  ADD COLUMN "segnalataAt"            TIMESTAMP(3),
  ADD COLUMN "segnalataDaUserId"      UUID,
  ADD COLUMN "segnalazioneStato"      "SegnalazionePraticaStato",
  ADD COLUMN "segnalazioneEsitaAt"    TIMESTAMP(3),
  ADD COLUMN "segnalazioneEsitaDaId"  UUID,
  ADD COLUMN "penaleAddebitatoCent"   INTEGER;

-- CreateIndex: lookup veloce delle pratiche segnalate (admin /admin/segnalazioni)
CREATE INDEX "pratiche_flagSegnalata_idx" ON "pratiche"("flagSegnalata");

-- CreateTable: log immutabile delle dichiarazioni di responsabilità broker
CREATE TABLE "broker_dichiarazioni" (
  "id"           UUID NOT NULL,
  "praticaId"    UUID NOT NULL,
  "userId"       UUID NOT NULL,
  "ip"           TEXT,
  "userAgent"    TEXT,
  "popupVersion" TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "broker_dichiarazioni_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "broker_dichiarazioni_praticaId_idx" ON "broker_dichiarazioni"("praticaId");
CREATE INDEX "broker_dichiarazioni_userId_idx" ON "broker_dichiarazioni"("userId");

ALTER TABLE "broker_dichiarazioni"
  ADD CONSTRAINT "broker_dichiarazioni_praticaId_fkey"
  FOREIGN KEY ("praticaId") REFERENCES "pratiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "broker_dichiarazioni"
  ADD CONSTRAINT "broker_dichiarazioni_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
