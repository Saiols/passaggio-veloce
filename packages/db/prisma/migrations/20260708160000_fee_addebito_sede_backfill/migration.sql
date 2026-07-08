-- Backfill dati: `fee_addebiti.agenziaSedeId` non veniva valorizzato alla creazione
-- (la colonna esiste dalla 20260624013750_multi_sede_expand, ma solo il backfill
-- iniziale la popolava). Le fee create da allora hanno sede NULL e sparirebbero
-- da /addebiti una volta introdotto lo scoping per sede.
-- Deriva la sede dalla pratica collegata. Idempotente: tocca solo le righe NULL.
-- Nessun DDL: nessun lock di tabella oltre agli UPDATE.

UPDATE "fee_addebiti" f
SET "agenziaSedeId" = p."agenziaSedeId"
FROM "pratiche" p
WHERE f."praticaId" = p."id"
  AND f."agenziaSedeId" IS NULL
  AND p."agenziaSedeId" IS NOT NULL;
