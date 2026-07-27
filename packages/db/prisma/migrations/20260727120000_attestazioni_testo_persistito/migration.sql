-- Attestazione tracciabile dell'informativa ai terzi (spec 2026-07-27).
--
-- Il record `broker_dichiarazioni` persisteva solo `popupVersion`: il testo era
-- ricostruibile solo risalendo al commit giusto, e solo finche' nessuno
-- modificava il copy dimenticando di bumpare la versione. Da qui in avanti il
-- record porta con se' il testo che l'utente ha letto.
--
-- ⚠️ MIGRATION DI SOLA ESPANSIONE, colonne NULLABLE: va lanciata PRIMA del
-- deploy del codice nuovo ed e' compatibile con quello vecchio, che le ignora.
--
-- Nessun backfill. I record gia' scritti (dal go-live del 2026-07-22) sono in
-- v3.0 e v3.1, entrambe presenti nel registro `lib/legal/attestazioni.ts` col
-- loro testo storico: la card admin li rende per intero partendo dalla
-- versione. Inventare un testo per righe gia' scritte sarebbe il contrario di
-- una prova.
ALTER TABLE "broker_dichiarazioni" ADD COLUMN "testoAttestazioni" JSONB;
ALTER TABLE "broker_dichiarazioni" ADD COLUMN "clausolaTerzi" INTEGER;
