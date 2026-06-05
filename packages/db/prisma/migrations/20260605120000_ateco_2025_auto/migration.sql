-- ATECO 2025: la riforma ha riclassificato il commercio di autoveicoli al
-- codice 47.81.x (es. 47.81.10 "commercio al dettaglio di automobili"). Le visure
-- riportano sia il nuovo codice sia il vecchio ATECORI 2007 (45.11.x). Aggiungiamo
-- il prefisso 4781 alla allowlist dealer per i casi in cui la visura mostri solo
-- il codice 2025. Idempotente.
INSERT INTO "ateco_allowed_codes" ("id", "companyType", "code", "label", "active", "createdAt") VALUES
  (gen_random_uuid(), 'DEALER', '4781', 'Commercio al dettaglio autoveicoli (ATECO 2025)', true, CURRENT_TIMESTAMP)
ON CONFLICT ("companyType", "code") DO NOTHING;
