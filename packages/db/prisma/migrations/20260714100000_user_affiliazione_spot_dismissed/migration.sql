-- Modale di lancio del programma affiliazione (post-login): "non mostrare più".
-- Additiva e nullable: gli utenti esistenti restano a NULL, cioè vedono la
-- modale al prossimo login (che è il comportamento voluto per il lancio).
ALTER TABLE "users" ADD COLUMN "affiliazioneSpotDismissedAt" TIMESTAMP(3);
