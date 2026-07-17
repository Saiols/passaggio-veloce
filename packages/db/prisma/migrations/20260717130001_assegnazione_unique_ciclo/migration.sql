-- Ricircolo revoca: la ripartenza pulita ricontatta al round 1 del NUOVO ciclo anche
-- le sedi già contattate nei cicli precedenti (tranne le REVOCATA_ADMIN, escluse per
-- sempre). Senza `ciclo` nel vincolo unico, il secondo create (praticaId, sedeId,
-- round=1) di un nuovo ciclo esploderebbe con P2002 e farebbe rollback della revoca.
-- Le righe esistenti (tutte ciclo=1) non possono violare il nuovo vincolo, che è più
-- largo del precedente: nessun rischio in ricreazione.

-- DropIndex
DROP INDEX "pratiche_assegnazioni_praticaId_sedeId_round_key";

-- CreateIndex
CREATE UNIQUE INDEX "pratiche_assegnazioni_praticaId_sedeId_round_ciclo_key" ON "pratiche_assegnazioni"("praticaId", "sedeId", "round", "ciclo");
