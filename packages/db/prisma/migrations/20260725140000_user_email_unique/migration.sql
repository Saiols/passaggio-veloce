-- Email univoca su tutta la piattaforma (spec 2026-07-25).
-- Revoca la multi-tenancy dell'email introdotta da team_email_per_company
-- (20260505224500), che permetteva a due aziende diverse di registrarsi con
-- la stessa email.

-- Il compound e il partial index diventano ridondanti: li sostituisce un
-- unique secco. `users_email_idx` cade perche' l'indice unique serve gia' i
-- lookup per email, e un secondo btree sulla stessa colonna costa scritture.
DROP INDEX IF EXISTS "users_companyId_email_key";
DROP INDEX IF EXISTS "users_email_admin_platform_key";
DROP INDEX IF EXISTS "users_email_idx";

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- Un unique btree e' case-sensitive: senza questo, 'Mario@x.it' e 'mario@x.it'
-- resterebbero due account distinti, cioe' lo stesso bug per un'altra strada.
-- Tutti i write path normalizzano gia' in lowercase; il vincolo garantisce che
-- un path futuro non possa dimenticarsene.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK (email = lower(email));
