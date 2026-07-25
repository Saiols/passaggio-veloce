-- Distribuzione: raggio in linea d'aria, round configurabili, metrica di
-- accettazione. Vedi docs/superpowers/specs/2026-07-25-distribuzione-round-config-design.md
--
-- SOLO ADDITIVA: si applica PRIMA del deploy, mentre il codice vecchio gira
-- ancora. Il DROP di `road_distance_cache` sta apposta nella migration
-- successiva (20260725130000), da applicare DOPO il deploy: il codice
-- attualmente in prod legge quella tabella senza try/catch, quindi droppandola
-- in anticipo la creazione pratica crasherebbe.

-- Round = ordinale del batch di notifiche realmente inviato (gli anelli vuoti
-- non lo fanno avanzare). `roundCorrente` riparte da 1 a ogni ciclo.
ALTER TABLE "pratiche"
  ADD COLUMN "roundCorrente" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "roundAccettazione" INTEGER;

-- Nuovi default: 1 km iniziale, +1 km per round, 1 h per round.
ALTER TABLE "distribuzione_config" ALTER COLUMN "raggioStartM"  SET DEFAULT 1000;
ALTER TABLE "distribuzione_config" ALTER COLUMN "stepM"         SET DEFAULT 1000;
ALTER TABLE "distribuzione_config" ALTER COLUMN "intervalloMin" SET DEFAULT 60;

-- Cambiare il DEFAULT non tocca la riga già esistente: il singleton creato
-- dalla migration 20260721120000_distribuzione_v2 ha ancora 500/200/10 e va
-- aggiornato esplicitamente. `raggioMaxM` NON si tocca: se l'admin l'ha già
-- modificato dalla UI, il suo valore deve restare.
UPDATE "distribuzione_config"
   SET "raggioStartM" = 1000, "stepM" = 1000, "intervalloMin" = 60
 WHERE "id" = 'singleton';
