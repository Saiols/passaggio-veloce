-- Multi-tenancy email scope-company (item 07 release 2026-05).
-- La stessa email puo' esistere in piu' aziende. L'unicita' globale
-- precedente bloccava la creazione di team member con email gia' usata
-- altrove (es. fra dealer e agenzia).

-- DropIndex (vecchio unique globale)
DROP INDEX IF EXISTS "users_email_key";

-- CreateIndex (unique compound scope-company)
CREATE UNIQUE INDEX "users_companyId_email_key" ON "users"("companyId", "email");

-- CreateIndex (lookup veloce per email durante login)
CREATE INDEX "users_email_idx" ON "users"("email");

-- Partial unique index: per gli admin platform (companyId IS NULL) due record
-- con la stessa email darebbero entrambi (NULL, 'x@y') che in PostgreSQL non
-- e' considerato duplicato. Forziamo l'unicita' con un partial index.
CREATE UNIQUE INDEX "users_email_admin_platform_key"
  ON "users"("email")
  WHERE "companyId" IS NULL;
