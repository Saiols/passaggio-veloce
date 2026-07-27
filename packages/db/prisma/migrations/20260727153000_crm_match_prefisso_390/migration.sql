-- Emendamento al piano di riconciliazione CRM (giro di correzioni 1/5,
-- 2026-07-27): `normalizeTel` tagliava il prefisso internazionale '39'
-- solo per blocchi di più di 10 cifre, per non rovinare i cellulari 39x
-- (391/392/393…) scritti senza '+'. Conseguenza: un fisso corto scritto con
-- l'internazionale restava sbagliato — '+39 055 46501' normalizzava a
-- '3905546501' invece di '05546501'. Sono 206 righe reali su 19.103 (1 a 8
-- cifre, 5 a 9, 200 a 10).
--
-- I numeri di rete fissa italiani iniziano sempre per '0' (il distrettuale)
-- e nessun prefisso mobile italiano è '390': un blocco cifre che inizia per
-- '390' è quindi SEMPRE prefisso internazionale + fisso, qualunque sia la
-- lunghezza. `lib/crm/match/normalize.ts` (`normalizeTel`) è stato corretto
-- di conseguenza con una regola dedicata per il blocco '390...'.
--
-- La migration `20260727150000_crm_match_normalizzato` è già applicata (il
-- checksum Prisma la protegge): qui si RICALCOLA telNorm/waNorm dai campi
-- grezzi tel/wa con la stessa logica corretta, invece di patchare la
-- migration precedente. Idempotente: ricalcola da tel/wa, non da telNorm/
-- waNorm già scritti, quindi si può rilanciare senza effetti collaterali.
UPDATE "crm_contacts" SET "telNorm" = CASE
    WHEN regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g') LIKE '0039%'
      THEN substr(regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g'), 5)
    WHEN regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g') LIKE '390%'
      THEN substr(regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g'), 3)
    WHEN regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g') LIKE '39%'
     AND length(regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g')) > 10
      THEN substr(regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g'), 3)
    ELSE regexp_replace(COALESCE("tel", ''), '[^0-9]', '', 'g')
  END;
UPDATE "crm_contacts" SET "waNorm" = CASE
    WHEN regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g') LIKE '0039%'
      THEN substr(regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g'), 5)
    WHEN regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g') LIKE '390%'
      THEN substr(regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g'), 3)
    WHEN regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g') LIKE '39%'
     AND length(regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g')) > 10
      THEN substr(regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g'), 3)
    ELSE regexp_replace(COALESCE("wa", ''), '[^0-9]', '', 'g')
  END;

-- Stesso filtro di lunghezza minima della migration precedente: sotto le 8
-- cifre la chiave è troppo debole per fare da prova d'identità.
UPDATE "crm_contacts" SET "telNorm" = NULL WHERE length(COALESCE("telNorm", '')) < 8;
UPDATE "crm_contacts" SET "waNorm" = NULL WHERE length(COALESCE("waNorm", '')) < 8;
