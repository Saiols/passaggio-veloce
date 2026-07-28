-- packages/db/prisma/migrations/20260728120000_crm_contacts_arricchimento/migration.sql
-- Arricchimento del contatto CRM dai dati dell'iscrizione.
--
-- Quando il motore di match aggancia una riga della lista all'azienda
-- registrata, i campi anagrafici vuoti del contatto vengono riempiti con i
-- dati della registrazione. Queste due colonne dicono QUALI campi non sono
-- stati raccolti al telefono ma ereditati dalla piattaforma: senza, il
-- venditore non ha modo di sapere che l'email che sta per usare non gliel'ha
-- mai dettata nessuno.
--
-- `arricchitoDa` è un CSV di nomi di campo in ordine canonico
-- (es. 'email,citta,regione') e si ACCUMULA fra una passata e l'altra.
-- Nessun indice: non ci si filtra sopra, si legge solo aprendo il contatto.
ALTER TABLE "crm_contacts" ADD COLUMN "arricchitoDa" TEXT;
ALTER TABLE "crm_contacts" ADD COLUMN "arricchitoAt" TIMESTAMP(3);
