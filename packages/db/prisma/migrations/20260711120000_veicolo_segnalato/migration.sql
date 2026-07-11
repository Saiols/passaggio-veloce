-- Sistema Penali Broker: quali veicoli sono oggetto della segnalazione.
ALTER TABLE "veicoli" ADD COLUMN "segnalato" BOOLEAN NOT NULL DEFAULT false;
