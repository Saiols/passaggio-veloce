-- Clausola 3 dei Termini: il prezzo non cambia piu' nell'istante in cui l'admin
-- salva, ma da una DATA DI EFFICACIA futura, dopo il preavviso via email
-- (7 giorni fino al 20%, 30 giorni + riaccettazione oltre).
--
-- ⚠️ MIGRATION DI SOLA ESPANSIONE: aggiunge, non toglie. Va lanciata PRIMA del
-- deploy del codice nuovo ed e' compatibile con quello vecchio, che continua a
-- leggere `attivo` finche' non viene sostituito. La rimozione di `attivo` vive
-- nella migration gemella `20260726202000_drop_tariffa_attivo`, da lanciare
-- DOPO il deploy.
--
-- Perche' separarle: droppare `attivo` mentre in produzione gira ancora il
-- codice che lo legge non da' un errore visibile — `getTariffarioCorrente` ha
-- un catch che ricade su DEFAULT_TARIFFARIO, quindi le pratiche verrebbero
-- prezzate coi valori di default (minivoltura 15 EUR invece di 50) senza che
-- nessuno se ne accorga. `accredit.ts` invece non ha catch: la transazione di
-- firma esploderebbe. Nessuno dei due e' accettabile per la manciata di minuti
-- di un deploy.
--
-- 1) `efficaceDal`, che sostituira' `attivo`.
--
-- Il booleano aveva un solo significato possibile ("questa e' la riga buona") e
-- con le variazioni programmate ne servivano due, "pubblicata" e "in vigore".
-- Tenerli entrambi su una colonna sola avrebbe prodotto, prima o poi, una
-- tariffa applicata prima di essere stata comunicata: esattamente cio' che la
-- clausola vieta. Backfill con `createdAt`: le righe storiche erano append-only
-- e la piu' recente era quella `attivo=true`, quindi l'ordinamento per
-- efficacia coincide con quello per creazione e la tariffa corrente non cambia
-- valore in nessun ambiente.
ALTER TABLE "tariffe_piattaforma" ADD COLUMN "efficaceDal" TIMESTAMP(3);
UPDATE "tariffe_piattaforma" SET "efficaceDal" = "createdAt" WHERE "efficaceDal" IS NULL;
ALTER TABLE "tariffe_piattaforma" ALTER COLUMN "efficaceDal" SET NOT NULL;

ALTER TABLE "tariffe_piattaforma" ADD COLUMN "richiedeRiaccettazione" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tariffe_piattaforma" ADD COLUMN "scostamentoMassimoBp" INTEGER;
ALTER TABLE "tariffe_piattaforma" ADD COLUMN "strutturale" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tariffe_piattaforma" ADD COLUMN "annullataAt" TIMESTAMP(3);
ALTER TABLE "tariffe_piattaforma" ADD COLUMN "annullataDaId" UUID;

CREATE INDEX "tariffe_piattaforma_efficaceDal_idx" ON "tariffe_piattaforma"("efficaceDal");

ALTER TABLE "tariffe_piattaforma"
  ADD CONSTRAINT "tariffe_piattaforma_annullataDaId_fkey"
  FOREIGN KEY ("annullataDaId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) Snapshot dell'affiliazione sulla pratica.
--
-- Fee agenzia e credito broker erano gia' congelati alla creazione della
-- pratica; l'affiliazione no, la rileggeva viva alla firma. Con una variazione
-- nel mezzo il referente incassava una commissione diversa da quella
-- pubblicata quando la pratica e' partita. Default 0 e nessun backfill: le
-- pratiche gia' firmate hanno gia' accreditato, e per quelle ancora aperte
-- `accredit.ts` ricade sulla tariffa corrente quando il valore e' 0 (vedi il
-- commento la').
ALTER TABLE "pratiche" ADD COLUMN "affiliazioneCent" INTEGER NOT NULL DEFAULT 0;

-- 3) Riaccettazione esplicita delle variazioni rilevanti (fascia b).
--
-- Il consenso e' dell'azienda ma lo presta una persona: si registrano
-- entrambi, piu' IP e user-agent, perche' e' il tipo di accettazione che in
-- contenzioso va dimostrata. Lo unique impedisce di riaccettare due volte la
-- stessa variazione.
CREATE TABLE "riaccettazioni_tariffa" (
  "id"        UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "tariffaId" UUID NOT NULL,
  "userId"    UUID NOT NULL,
  "ip"        TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "riaccettazioni_tariffa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "riaccettazioni_tariffa_companyId_tariffaId_key"
  ON "riaccettazioni_tariffa"("companyId", "tariffaId");
CREATE INDEX "riaccettazioni_tariffa_tariffaId_idx"
  ON "riaccettazioni_tariffa"("tariffaId");

ALTER TABLE "riaccettazioni_tariffa"
  ADD CONSTRAINT "riaccettazioni_tariffa_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "riaccettazioni_tariffa"
  ADD CONSTRAINT "riaccettazioni_tariffa_tariffaId_fkey"
  FOREIGN KEY ("tariffaId") REFERENCES "tariffe_piattaforma"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "riaccettazioni_tariffa"
  ADD CONSTRAINT "riaccettazioni_tariffa_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
