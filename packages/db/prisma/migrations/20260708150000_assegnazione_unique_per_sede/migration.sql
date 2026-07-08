-- Distribuzione multi-sede: l'assegnataria di una pratica è la SEDE, non la madre.
-- Da quando ogni sede in zona compete in modo indipendente (rimosso dedupeByMadre),
-- due filiali della stessa azienda madre finiscono nello stesso round con lo stesso
-- `agenziaId`: il vecchio vincolo unico le vietava e il secondo INSERT falliva con
-- P2002, mandando in rollback la transazione di creazione pratica (500 su /pratiche/nuova).
--
-- Il nuovo vincolo è più stretto sulla colonna che conta davvero (sedeId) e non può
-- essere violato dalle righe esistenti: una sede appartiene a una sola madre, quindi
-- un duplicato (praticaId, sedeId, round) implicherebbe un duplicato
-- (praticaId, agenziaId, round), impossibile sotto il vincolo che stiamo rimuovendo.
-- Le righe legacy con sedeId NULL restano ammesse (in Postgres i NULL sono distinti).

-- DropIndex
DROP INDEX "pratiche_assegnazioni_praticaId_agenziaId_round_key";

-- CreateIndex
CREATE UNIQUE INDEX "pratiche_assegnazioni_praticaId_sedeId_round_key" ON "pratiche_assegnazioni"("praticaId", "sedeId", "round");
