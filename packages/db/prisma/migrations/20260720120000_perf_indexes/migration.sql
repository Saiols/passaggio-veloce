-- CreateIndex
CREATE INDEX "EventoPratica_targetSedeId_seenAt_idx" ON "eventi_pratica"("targetSedeId", "seenAt");

-- CreateIndex
CREATE INDEX "Sede_type_deletedAt_suspendedAt_idx" ON "sedi"("type", "deletedAt", "suspendedAt");

-- CreateIndex
CREATE INDEX "Pratica_agenziaSedeId_stato_idx" ON "pratiche"("agenziaSedeId", "stato");

-- CreateIndex
CREATE INDEX "Pratica_brokerSedeId_stato_idx" ON "pratiche"("brokerSedeId", "stato");
