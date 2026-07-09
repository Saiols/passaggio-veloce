-- Migration DATI (nessun cambio di schema).
--
-- Dal 2026-06-24 il wallet operativo appartiene alla SEDE (vedi
-- 20260624013750_multi_sede_expand, punto 4). Il flusso penale ha continuato a
-- risolvere il wallet per companyId, creando wallet "madre" nuovi e
-- addebitandoci PENALE_BROKER (e l'eventuale STORNO). Quei wallet la pagina li
-- mostra al solo proprietario: operatori e admin di sede non vedevano la penale.
--
-- Qui spostiamo quelle transazioni sul wallet della sede della pratica e
-- correggiamo i saldi con DELTA (non ricalcoli globali: un ricalcolo
-- "aggiusterebbe" in silenzio anche drift che non abbiamo indagato).
--
-- Idempotente: dopo lo spostamento le righe non soddisfano più il join su
-- wallets.companyId, quindi una riesecuzione non fa nulla.
--
-- Non tocchiamo mai: CREDITO_AFFILIAZIONE, payouts, saldoPostCent (audit
-- storico: è il saldo *in quel momento*, non un valore da ricalcolare).

-- 1) Wallet di sede mancanti per le sedi coinvolte.
INSERT INTO "wallets" ("id", "sedeId", "saldoCent", "createdAt", "updatedAt")
SELECT gen_random_uuid(), p."brokerSedeId", 0, now(), now()
FROM "transazioni_wallet" t
JOIN "wallets" wm ON wm."id" = t."walletId" AND wm."companyId" IS NOT NULL
JOIN "pratiche" p ON p."id" = t."praticaId"
WHERE t."tipo" IN ('PENALE_BROKER', 'STORNO')
  AND p."brokerSedeId" IS NOT NULL
GROUP BY p."brokerSedeId"
ON CONFLICT ("sedeId") DO NOTHING;

-- 2) Il wallet madre perde l'effetto delle transazioni che se ne vanno.
--    Gli importi sono negativi, quindi sottrarne la somma alza il saldo.
UPDATE "wallets" w
SET "saldoCent" = w."saldoCent" - x."delta", "updatedAt" = now()
FROM (
  SELECT t."walletId" AS wid, SUM(t."importoCent") AS delta
  FROM "transazioni_wallet" t
  JOIN "wallets" wm ON wm."id" = t."walletId" AND wm."companyId" IS NOT NULL
  JOIN "pratiche" p ON p."id" = t."praticaId"
  JOIN "wallets" ws ON ws."sedeId" = p."brokerSedeId"
  WHERE t."tipo" IN ('PENALE_BROKER', 'STORNO')
  GROUP BY t."walletId"
) x
WHERE w."id" = x."wid";

-- 3) Il wallet di sede acquisisce quell'effetto.
UPDATE "wallets" w
SET "saldoCent" = w."saldoCent" + x."delta", "updatedAt" = now()
FROM (
  SELECT ws."id" AS wid, SUM(t."importoCent") AS delta
  FROM "transazioni_wallet" t
  JOIN "wallets" wm ON wm."id" = t."walletId" AND wm."companyId" IS NOT NULL
  JOIN "pratiche" p ON p."id" = t."praticaId"
  JOIN "wallets" ws ON ws."sedeId" = p."brokerSedeId"
  WHERE t."tipo" IN ('PENALE_BROKER', 'STORNO')
  GROUP BY ws."id"
) x
WHERE w."id" = x."wid";

-- 4) Sposta le transazioni. DEVE venire dopo i due UPDATE: quelli leggono
--    ancora le righe sul wallet madre.
UPDATE "transazioni_wallet" t
SET "walletId" = ws."id"
FROM "wallets" wm, "pratiche" p, "wallets" ws
WHERE t."walletId" = wm."id"
  AND wm."companyId" IS NOT NULL
  AND p."id" = t."praticaId"
  AND ws."sedeId" = p."brokerSedeId"
  AND t."tipo" IN ('PENALE_BROKER', 'STORNO');

-- 5) Elimina i wallet madre rimasti vuoti: sono quelli nati dal solo bug.
--    Un wallet madre con commissioni di affiliazione reali ha transazioni e non
--    viene toccato. Uno vuoto viene ricreato al primo accredito, se serve.
DELETE FROM "wallets" w
WHERE w."companyId" IS NOT NULL
  AND w."saldoCent" = 0
  AND NOT EXISTS (SELECT 1 FROM "transazioni_wallet" t WHERE t."walletId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "payouts" p WHERE p."walletId" = w."id");
