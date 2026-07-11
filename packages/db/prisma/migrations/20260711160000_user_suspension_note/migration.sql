-- Clausola 11.3-bis dei Termini: la sospensione della SINGOLA utenza è
-- comunicata via email con indicazione del motivo. Serve una colonna per
-- tenerne traccia sull'audit trail (Company ha gia' l'analoga
-- suspensionLastNote per la sospensione dell'intera azienda).
ALTER TABLE "users" ADD COLUMN "suspensionLastNote" TEXT;
