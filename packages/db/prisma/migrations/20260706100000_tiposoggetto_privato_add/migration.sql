-- Separazione "tipo soggetto" ↔ "variante CI" (step 1/3: additivo).
-- La variante della carta d'identità (solo privato) diventa un campo a sé:
-- la CIE elettronica contiene il codice fiscale, la cartacea no.

-- Nuovo enum per la variante CI.
CREATE TYPE "CiTipo" AS ENUM ('CARTACEA', 'ELETTRONICA');

-- Nuovo valore soggetto "privato" unificato. I vecchi PRIVATO_ITALIANO_CIE/
-- CARTACEA restano finché il backfill (step 2) non li converte; vengono rimossi
-- nello step 3. NB: un valore enum appena aggiunto non è utilizzabile nella
-- stessa transazione → il backfill è una migration separata.
ALTER TYPE "TipoSoggetto" ADD VALUE 'PRIVATO_ITALIANO';

-- Colonna variante CI ovunque sia persistito il tipo soggetto.
ALTER TABLE "venditori" ADD COLUMN "ciTipo" "CiTipo";
ALTER TABLE "co_acquirenti" ADD COLUMN "ciTipo" "CiTipo";
ALTER TABLE "pratiche" ADD COLUMN "acquirenteCiTipo" "CiTipo";
