-- Clausola 3: comunicazione della variazione tariffaria a tutti gli Utenti.
-- E' l'email da cui decorre il preavviso contrattuale (7 o 30 giorni), quindi
-- non entra mai fra le notifiche opzionali: disattivarla renderebbe inefficace
-- la variazione stessa.
ALTER TYPE "NotificaTipo" ADD VALUE 'N54_VARIAZIONE_TARIFFE';
