-- Separazione "tipo soggetto" ↔ "variante CI" (step 2/3: backfill dati).
-- Converte i vecchi valori nel nuovo modello: privato unificato + variante CI.
--   PRIVATO_ITALIANO_CIE      → (PRIVATO_ITALIANO, ELETTRONICA)
--   PRIVATO_ITALIANO_CARTACEA → (PRIVATO_ITALIANO, CARTACEA)
-- Migration separata dallo step 1: il valore enum aggiunto lì è ora committato
-- e quindi utilizzabile qui.

UPDATE "venditori"     SET "tipoSoggetto" = 'PRIVATO_ITALIANO', "ciTipo" = 'ELETTRONICA' WHERE "tipoSoggetto" = 'PRIVATO_ITALIANO_CIE';
UPDATE "venditori"     SET "tipoSoggetto" = 'PRIVATO_ITALIANO', "ciTipo" = 'CARTACEA'    WHERE "tipoSoggetto" = 'PRIVATO_ITALIANO_CARTACEA';

UPDATE "co_acquirenti" SET "tipoSoggetto" = 'PRIVATO_ITALIANO', "ciTipo" = 'ELETTRONICA' WHERE "tipoSoggetto" = 'PRIVATO_ITALIANO_CIE';
UPDATE "co_acquirenti" SET "tipoSoggetto" = 'PRIVATO_ITALIANO', "ciTipo" = 'CARTACEA'    WHERE "tipoSoggetto" = 'PRIVATO_ITALIANO_CARTACEA';

UPDATE "pratiche" SET "acquirenteTipoSoggetto" = 'PRIVATO_ITALIANO', "acquirenteCiTipo" = 'ELETTRONICA' WHERE "acquirenteTipoSoggetto" = 'PRIVATO_ITALIANO_CIE';
UPDATE "pratiche" SET "acquirenteTipoSoggetto" = 'PRIVATO_ITALIANO', "acquirenteCiTipo" = 'CARTACEA'    WHERE "acquirenteTipoSoggetto" = 'PRIVATO_ITALIANO_CARTACEA';
