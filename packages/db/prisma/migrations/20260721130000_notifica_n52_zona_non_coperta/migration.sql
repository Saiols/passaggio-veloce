-- Distribuzione v2 (Task 4): nuovo tipo notifica per il broker quando la
-- pratica raggiunge il raggio massimo senza nessuna agenzia disponibile
-- ("zona non coperta"). Nessun UPDATE/INSERT nella stessa migration che usi
-- il nuovo valore, quindi ALTER TYPE ... ADD VALUE può stare qui da sola.
ALTER TYPE "NotificaTipo" ADD VALUE IF NOT EXISTS 'N52_BROKER_ZONA_NON_COPERTA';
