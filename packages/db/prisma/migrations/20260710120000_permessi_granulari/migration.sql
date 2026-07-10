-- Permessi granulari per le utenze azienda.
-- Additiva: le colonne nascono vuote, il codice in prod le ignora finché i gate non sono attivi.
ALTER TABLE "users" ADD COLUMN "permessi" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "invitations" ADD COLUMN "permessi" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
