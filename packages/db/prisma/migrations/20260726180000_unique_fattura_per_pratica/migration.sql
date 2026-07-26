-- Una sola FATTURA_PV per pratica.
--
-- Lo unique gia' presente su (emittenteCompanyId, anno, numeroProgressivo, tipo)
-- NON copre le FATTURA_PV: per loro `emittenteCompanyId` e' NULL e in Postgres
-- i NULL sono distinti, quindi quel vincolo non le tocca. Senza questo indice
-- l'idempotenza di createFatturaPv resta un leggi-poi-scrivi che due chiamanti
-- concorrenti (percorso d'incasso e riconciliazione oraria) possono
-- attraversare entrambi, producendo due documenti fiscali sulla stessa pratica.
--
-- Le righe con `praticaId` NULL (i DOC_BROKER, agganciati al payout) non sono
-- vincolate: in Postgres i NULL sono distinti fra loro.
--
-- Il nome dell'indice e' quello che Prisma genera per @@unique([praticaId, tipo]):
-- cambiarlo farebbe risultare lo schema in deriva al primo `migrate status`.
CREATE UNIQUE INDEX "documenti_fiscali_praticaId_tipo_key"
  ON "documenti_fiscali"("praticaId", "tipo");
