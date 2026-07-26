-- Anzianita' della zona non coperta, indipendente dalle riprese.
--
-- `zonaNonCopertaAt` portava due significati: "e' ferma adesso" e "e' ferma da
-- quando". La ripresa (una nuova agenzia entra in zona) azzera legittimamente
-- il primo e cosi' distruggeva il secondo: il monitoraggio perdeva l'anzianita'
-- reale e il broker riceveva una N52 nuova a ogni ri-dichiarazione.
--
-- La colonna nuova tiene SOLO la prima dichiarazione del ciclo corrente: la
-- ripresa non la tocca, il ricircolo dopo revoca la azzera insieme agli altri
-- campi di ciclo.
ALTER TABLE "pratiche"
  ADD COLUMN "zonaNonCopertaPrimaAt" TIMESTAMP(3);

-- Backfill: per le pratiche gia' dichiarate scoperte, la prima dichiarazione
-- nota e' quella corrente. Additiva, nessun DEFAULT: le righe senza
-- `zonaNonCopertaAt` restano NULL (non sono in zona non coperta).
UPDATE "pratiche"
  SET "zonaNonCopertaPrimaAt" = "zonaNonCopertaAt"
  WHERE "zonaNonCopertaAt" IS NOT NULL;
