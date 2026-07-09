-- Chi ha creato la pratica e chi l'ha accettata.
-- Additiva: due colonne nullable. Le pratiche esistenti restano a NULL e le
-- loro notifiche continuano a ricadere sull'admin azienda, come prima.
ALTER TABLE "pratiche" ADD COLUMN "creatoDaUserId" UUID;
ALTER TABLE "pratiche" ADD COLUMN "accettataDaUserId" UUID;

-- SET NULL: la cancellazione fisica di un utente non deve portarsi via la pratica.
ALTER TABLE "pratiche"
  ADD CONSTRAINT "pratiche_creatoDaUserId_fkey"
  FOREIGN KEY ("creatoDaUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pratiche"
  ADD CONSTRAINT "pratiche_accettataDaUserId_fkey"
  FOREIGN KEY ("accettataDaUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
