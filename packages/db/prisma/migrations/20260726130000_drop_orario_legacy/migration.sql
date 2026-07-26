-- Le tre colonne sono sostituite da "orariSettimana" (migration 20260726120000).
-- Da applicare SOLO DOPO il deploy del codice che non le legge più: la versione
-- precedente le legge in getDistribuzioneConfig, e senza di esse cadrebbe nel
-- catch fail-open, ignorando in silenzio la configurazione reale.
ALTER TABLE "distribuzione_config"
  DROP COLUMN "orarioInizio",
  DROP COLUMN "orarioFine",
  DROP COLUMN "giorni";
