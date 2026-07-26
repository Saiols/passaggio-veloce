-- Fattura dopo incasso (Task 5): nuovo tipo notifica per l'agenzia quando la
-- FATTURA_PV nasce all'incasso dell'addebito SEPA ("fattura disponibile").
-- Nessun UPDATE/INSERT nella stessa migration che usi il nuovo valore, quindi
-- ALTER TYPE ... ADD VALUE può stare qui da sola.
ALTER TYPE "NotificaTipo" ADD VALUE IF NOT EXISTS 'N53_AGENZIA_FATTURA_DISPONIBILE';
