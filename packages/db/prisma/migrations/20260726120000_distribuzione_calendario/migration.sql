-- Calendario della piattaforma: fasce per giorno + festivi.
-- Colonne NULLABLE: null → il parsing applicativo usa i default (fail-open).
ALTER TABLE "distribuzione_config"
  ADD COLUMN "orariSettimana" JSONB,
  ADD COLUMN "festivi" JSONB;

-- Conversione FEDELE della configurazione esistente: la fascia unica diventa la
-- fascia di ogni giorno, e i giorni elencati in `giorni` restano gli attivi.
-- Il sabato corto NON viene introdotto qui: e' una scelta operativa da fare dal
-- pannello. I giorni spenti ricevono comunque una fascia sensata.
UPDATE "distribuzione_config" SET "orariSettimana" = jsonb_build_object(
  'LUN', jsonb_build_object('attivo', "giorni" LIKE '%LUN%', 'inizio', "orarioInizio", 'fine', "orarioFine"),
  'MAR', jsonb_build_object('attivo', "giorni" LIKE '%MAR%', 'inizio', "orarioInizio", 'fine', "orarioFine"),
  'MER', jsonb_build_object('attivo', "giorni" LIKE '%MER%', 'inizio', "orarioInizio", 'fine', "orarioFine"),
  'GIO', jsonb_build_object('attivo', "giorni" LIKE '%GIO%', 'inizio', "orarioInizio", 'fine', "orarioFine"),
  'VEN', jsonb_build_object('attivo', "giorni" LIKE '%VEN%', 'inizio', "orarioInizio", 'fine', "orarioFine"),
  'SAB', jsonb_build_object('attivo', "giorni" LIKE '%SAB%', 'inizio', '09:00', 'fine', '13:00'),
  'DOM', jsonb_build_object('attivo', "giorni" LIKE '%DOM%', 'inizio', "orarioInizio", 'fine', "orarioFine")
) WHERE "id" = 'singleton';

-- Festivi nazionali italiani FUTURI (da agosto 2026) e tutto il 2027.
-- Pasquetta calcolata col computus gregoriano, non a memoria:
-- Pasqua 2027 = 28/03 (domenica) -> Pasquetta 29/03/2027.
-- La domenica di Pasqua non e' in elenco: la domenica e' gia' un giorno spento.
UPDATE "distribuzione_config" SET "festivi" = '[
  {"data":"2026-08-15","nome":"Ferragosto"},
  {"data":"2026-11-01","nome":"Ognissanti"},
  {"data":"2026-12-08","nome":"Immacolata"},
  {"data":"2026-12-25","nome":"Natale"},
  {"data":"2026-12-26","nome":"Santo Stefano"},
  {"data":"2027-01-01","nome":"Capodanno"},
  {"data":"2027-01-06","nome":"Epifania"},
  {"data":"2027-03-29","nome":"Lunedì dell''Angelo"},
  {"data":"2027-04-25","nome":"Liberazione"},
  {"data":"2027-05-01","nome":"Festa del Lavoro"},
  {"data":"2027-06-02","nome":"Festa della Repubblica"},
  {"data":"2027-08-15","nome":"Ferragosto"},
  {"data":"2027-11-01","nome":"Ognissanti"},
  {"data":"2027-12-08","nome":"Immacolata"},
  {"data":"2027-12-25","nome":"Natale"},
  {"data":"2027-12-26","nome":"Santo Stefano"}
]'::jsonb WHERE "id" = 'singleton';
