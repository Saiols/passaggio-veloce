-- Log accessi e attivita' (art. 32 GDPR), conservato 24 mesi.
--
-- Perche' esiste, dato che c'e' gia' Google Analytics: GA e' subordinato al
-- consenso (chi lo rifiuta e' invisibile), non conosce l'identita' dell'utente
-- — mandargliela sarebbe una violazione a se' — non vede nulla di cio' che
-- accade lato server, e non e' utilizzabile come prova. Risponde a «come va il
-- prodotto», non a «chi ha scaricato la carta d'identita' di questo venditore».
--
-- L'elenco delle azioni e' VOLUTAMENTE CORTO e coincide con quello che dichiara
-- la privacy policy: autenticazione, accesso ai documenti, export di dati. Il
-- ciclo di vita delle pratiche ha gia' il suo tracciato in `pratica_stato_log`
-- (con attoreUserId), le email in `notifiche_inviate`, gli atti contrattuali in
-- `broker_dichiarazioni` / `mandati_fatturazione` / `riaccettazioni_tariffa`.
-- Loggare "ogni azione" costerebbe una scrittura per richiesta e creerebbe un
-- archivio di dati personali piu' grande del problema che risolve.
CREATE TYPE "LogAccessoAzione" AS ENUM (
  'LOGIN',
  'LOGIN_FALLITO',
  'LOGOUT',
  'DOCUMENTO_ACCESSO',
  'EXPORT_DATI'
);

CREATE TABLE "log_accessi" (
  "id"                 UUID NOT NULL,
  "azione"             "LogAccessoAzione" NOT NULL,
  -- NULL sui LOGIN_FALLITO con un'email inesistente: e' l'evento piu'
  -- interessante del log, non puo' dipendere dall'esistenza dell'utente.
  "userId"             UUID,
  "email"              TEXT,
  -- Azienda dell'attore, denormalizzata: l'utente puo' sparire, il log resta.
  "companyId"          UUID,
  -- Azienda bersaglio quando diversa da quella dell'attore: isola il caso
  -- dello staff di piattaforma che tocca i dati di un'azienda. Id nudo, NON
  -- una FK: il log deve sopravvivere alla cancellazione dell'azienda.
  "bersaglioCompanyId" UUID,
  "risorsaTipo"        TEXT,
  "risorsaId"          TEXT,
  -- Un 403 su un documento altrui e' il segnale piu' utile dell'intero log.
  "negato"             BOOLEAN NOT NULL DEFAULT false,
  "dettaglio"          TEXT,
  "ip"                 TEXT,
  "userAgent"          TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "log_accessi_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "log_accessi_userId_createdAt_idx" ON "log_accessi"("userId", "createdAt");
-- Serve al job di purge a 24 mesi, che cancella per sola data.
CREATE INDEX "log_accessi_createdAt_idx" ON "log_accessi"("createdAt");
CREATE INDEX "log_accessi_risorsaTipo_risorsaId_idx" ON "log_accessi"("risorsaTipo", "risorsaId");
CREATE INDEX "log_accessi_bersaglioCompanyId_createdAt_idx" ON "log_accessi"("bersaglioCompanyId", "createdAt");

-- SET NULL e non CASCADE: cancellare un utente non deve cancellare la prova di
-- cio' che ha fatto — sarebbe esattamente il contrario dello scopo del log.
ALTER TABLE "log_accessi"
  ADD CONSTRAINT "log_accessi_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "log_accessi"
  ADD CONSTRAINT "log_accessi_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
