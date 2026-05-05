-- CRM Bundle CRM-A — release 2026-05-06
-- Spec: docs/crm-spec-implementativa.md

-- AlterEnum: 5 nuovi UserRole per team interno PV
ALTER TYPE "UserRole" ADD VALUE 'AD';
ALTER TYPE "UserRole" ADD VALUE 'CTO';
ALTER TYPE "UserRole" ADD VALUE 'CFO';
ALTER TYPE "UserRole" ADD VALUE 'SALES_MANAGER';
ALTER TYPE "UserRole" ADD VALUE 'SALES';

-- CreateEnum
CREATE TYPE "CrmContactCategoria" AS ENUM ('BROKER', 'AGENZIA');

CREATE TYPE "CrmStatoContatto" AS ENUM (
  'S0','S1','S2','S3','S4','S5','S6','S7','S8','S9','S10'
);

CREATE TYPE "CrmFonteAcquisizione" AS ENUM (
  'CSV_INIZIALE','ISCRIZIONE_DIRETTA','REFERRAL','ALTRO'
);

CREATE TYPE "CrmCallEsito" AS ENUM (
  'NON_RISPONDE','NON_INTERESSATO','INTERESSATO','RICHIAMA','ISCRITTO'
);

CREATE TYPE "CrmSentiment" AS ENUM ('POSITIVO','NEUTRO','NEGATIVO');

CREATE TYPE "CrmPlatStatus" AS ENUM ('ATTIVO','INATTIVO','SOSPESO');

CREATE TYPE "CrmAgentLingua" AS ENUM ('ITALIANO','ENGLISH','ESPANOL');

CREATE TYPE "CrmAgentVoce" AS ENUM ('FEMMINILE_NATURALE','MASCHILE_NATURALE','CLONATA');

CREATE TYPE "CrmAgentAccento" AS ENUM (
  'NEUTRO_ITALIANO','NORD_ITALIA','CENTRO_ITALIA','SUD_ITALIA'
);

CREATE TYPE "CrmCampaignGiorni" AS ENUM ('LUN_VEN','LUN_SAB','TUTTI');

CREATE TYPE "CrmCampaignStato" AS ENUM ('ATTIVA','PAUSATA','CHIUSA');

CREATE TYPE "CrmChatbotCanale" AS ENUM ('SITO','WHATSAPP','MAIL','TUTTI');

-- CreateTable: CrmContact
CREATE TABLE "crm_contacts" (
  "id"              UUID NOT NULL,
  "nome"            TEXT NOT NULL,
  "cat"             "CrmContactCategoria" NOT NULL,
  "tel"             TEXT NOT NULL,
  "wa"              TEXT,
  "email"           TEXT,
  "piva"            TEXT,
  "indirizzo"       TEXT,
  "citta"           TEXT,
  "cap"             TEXT,
  "regione"         TEXT,
  "status"          "CrmStatoContatto" NOT NULL DEFAULT 'S0',
  "fonte"           "CrmFonteAcquisizione" NOT NULL,
  "assignedToId"    UUID,
  "lastContactAt"   TIMESTAMP(3),
  "nextContactAt"   TIMESTAMP(3),
  "callCount"       INTEGER NOT NULL DEFAULT 0,
  "callEsito"       "CrmCallEsito",
  "sentiment"       "CrmSentiment",
  "obiezioni"       TEXT,
  "noteAI"          TEXT,
  "trascrizione"    TEXT,
  "noteManuali"     TEXT,
  "linkInviato"     BOOLEAN NOT NULL DEFAULT false,
  "linkInviatoAt"   TIMESTAMP(3),
  "linkAperto"      BOOLEAN NOT NULL DEFAULT false,
  "linkAperture"    INTEGER NOT NULL DEFAULT 0,
  "videoInviato"    BOOLEAN NOT NULL DEFAULT false,
  "videoMin"        INTEGER NOT NULL DEFAULT 0,
  "mailAperta"      BOOLEAN NOT NULL DEFAULT false,
  "smsInviato"      BOOLEAN NOT NULL DEFAULT false,
  "waInviato"       BOOLEAN NOT NULL DEFAULT false,
  "iscrizioneInit"  BOOLEAN NOT NULL DEFAULT false,
  "iscrizioneComp"  BOOLEAN NOT NULL DEFAULT false,
  "iscrizioneAt"    TIMESTAMP(3),
  "companyId"       UUID,
  "platStatus"      "CrmPlatStatus",
  "primaPratica"    BOOLEAN NOT NULL DEFAULT false,
  "primaPraticaAt"  TIMESTAMP(3),
  "praticheTotal"   INTEGER NOT NULL DEFAULT 0,
  "praticheMonth"   INTEGER NOT NULL DEFAULT 0,
  "lastAccessAt"    TIMESTAMP(3),
  "tassoComp"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "deletedAt"       TIMESTAMP(3),

  CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crm_contacts_cat_idx" ON "crm_contacts"("cat");
CREATE INDEX "crm_contacts_status_idx" ON "crm_contacts"("status");
CREATE INDEX "crm_contacts_regione_idx" ON "crm_contacts"("regione");
CREATE INDEX "crm_contacts_assignedToId_idx" ON "crm_contacts"("assignedToId");
CREATE INDEX "crm_contacts_companyId_idx" ON "crm_contacts"("companyId");
CREATE INDEX "crm_contacts_linkAperto_idx" ON "crm_contacts"("linkAperto");

ALTER TABLE "crm_contacts"
  ADD CONSTRAINT "crm_contacts_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crm_contacts"
  ADD CONSTRAINT "crm_contacts_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: CrmSalesAgent
CREATE TABLE "crm_sales_agents" (
  "id"             UUID NOT NULL,
  "nome"           TEXT NOT NULL,
  "lingua"         "CrmAgentLingua" NOT NULL DEFAULT 'ITALIANO',
  "voce"           "CrmAgentVoce" NOT NULL DEFAULT 'FEMMINILE_NATURALE',
  "accento"        "CrmAgentAccento" NOT NULL DEFAULT 'NEUTRO_ITALIANO',
  "prompt"         TEXT NOT NULL,
  "scriptPrimo"    TEXT NOT NULL,
  "scriptFollowup" TEXT NOT NULL,
  "qa"             TEXT NOT NULL,
  "postCall"       TEXT NOT NULL,
  "vapiAgentId"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "deletedAt"      TIMESTAMP(3),

  CONSTRAINT "crm_sales_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CrmCampaign
CREATE TABLE "crm_campaigns" (
  "id"           UUID NOT NULL,
  "nome"         TEXT NOT NULL,
  "agentId"      UUID NOT NULL,
  "ownerId"      UUID NOT NULL,
  "regione"      TEXT,
  "cat"          "CrmContactCategoria",
  "statoTarget"  "CrmStatoContatto",
  "maxTry"       INTEGER NOT NULL DEFAULT 3,
  "intervalMin"  INTEGER NOT NULL DEFAULT 60,
  "oraStart"     TEXT NOT NULL DEFAULT '09:00',
  "oraEnd"       TEXT NOT NULL DEFAULT '18:00',
  "giorniAttivi" "CrmCampaignGiorni" NOT NULL DEFAULT 'LUN_VEN',
  "status"       "CrmCampaignStato" NOT NULL DEFAULT 'ATTIVA',
  "note"         TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "deletedAt"    TIMESTAMP(3),

  CONSTRAINT "crm_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crm_campaigns_agentId_idx" ON "crm_campaigns"("agentId");
CREATE INDEX "crm_campaigns_ownerId_idx" ON "crm_campaigns"("ownerId");
CREATE INDEX "crm_campaigns_status_idx" ON "crm_campaigns"("status");

ALTER TABLE "crm_campaigns"
  ADD CONSTRAINT "crm_campaigns_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "crm_sales_agents"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "crm_campaigns"
  ADD CONSTRAINT "crm_campaigns_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- CreateTable: CrmCampaignAssegnazione
CREATE TABLE "crm_campaign_assegnazioni" (
  "id"                UUID NOT NULL,
  "campaignId"        UUID NOT NULL,
  "contactId"         UUID NOT NULL,
  "tentativi"         INTEGER NOT NULL DEFAULT 0,
  "esitoUltimo"       "CrmCallEsito",
  "ultimaChiamataAt"  TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "crm_campaign_assegnazioni_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_campaign_assegnazioni_campaignId_contactId_key"
  ON "crm_campaign_assegnazioni"("campaignId","contactId");
CREATE INDEX "crm_campaign_assegnazioni_campaignId_idx"
  ON "crm_campaign_assegnazioni"("campaignId");

ALTER TABLE "crm_campaign_assegnazioni"
  ADD CONSTRAINT "crm_campaign_assegnazioni_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "crm_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_campaign_assegnazioni"
  ADD CONSTRAINT "crm_campaign_assegnazioni_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: CrmCall
CREATE TABLE "crm_calls" (
  "id"            UUID NOT NULL,
  "contactId"     UUID NOT NULL,
  "campaignId"    UUID,
  "agentId"       UUID,
  "startedAt"     TIMESTAMP(3) NOT NULL,
  "endedAt"       TIMESTAMP(3),
  "duration"      INTEGER,
  "esito"         "CrmCallEsito",
  "sentiment"     "CrmSentiment",
  "summary"       TEXT,
  "transcript"    TEXT,
  "obiezioniTags" TEXT,
  "vapiCallId"    TEXT,
  "recordingUrl"  TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "crm_calls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_calls_vapiCallId_key" ON "crm_calls"("vapiCallId");
CREATE INDEX "crm_calls_contactId_idx" ON "crm_calls"("contactId");
CREATE INDEX "crm_calls_campaignId_idx" ON "crm_calls"("campaignId");
CREATE INDEX "crm_calls_startedAt_idx" ON "crm_calls"("startedAt");

ALTER TABLE "crm_calls"
  ADD CONSTRAINT "crm_calls_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_calls"
  ADD CONSTRAINT "crm_calls_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "crm_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crm_calls"
  ADD CONSTRAINT "crm_calls_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "crm_sales_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: CrmChatbot
CREATE TABLE "crm_chatbots" (
  "id"         UUID NOT NULL,
  "nome"       TEXT NOT NULL,
  "target"     "CrmContactCategoria",
  "canale"     "CrmChatbotCanale" NOT NULL,
  "posizione"  TEXT,
  "attivo"     BOOLEAN NOT NULL DEFAULT true,
  "prompt"     TEXT NOT NULL,
  "obiettivo"  TEXT NOT NULL,
  "qa"         TEXT NOT NULL,
  "escalation" TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  "deletedAt"  TIMESTAMP(3),

  CONSTRAINT "crm_chatbots_pkey" PRIMARY KEY ("id")
);
