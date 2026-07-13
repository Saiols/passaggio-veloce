-- Approvazione specifica delle clausole vessatorie ex artt. 1341-1342 c.c.
-- Finora la seconda spunta della registrazione veniva validata e poi scartata:
-- nessuna prova dell'approvazione, né della versione dei Termini accettata.
-- Nullable e senza backfill: le aziende registrate prima restano a NULL, che è
-- la verità (non hanno approvato QUESTA versione).
ALTER TABLE "companies" ADD COLUMN "clausoleVessatorieAcceptedAt" TIMESTAMP(3);
ALTER TABLE "companies" ADD COLUMN "termsVersion" TEXT;
