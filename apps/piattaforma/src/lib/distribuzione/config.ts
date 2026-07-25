import { cache } from 'react';
import { prisma, type Prisma, type PrismaClient } from '@pv/db';
import {
  CALENDARIO_DEFAULT,
  parseFestivi,
  parseOrariSettimana,
  type CalendarioPiattaforma,
} from './calendario';

/** Accetta sia il client globale sia una transazione. */
type DistribuzioneConfigClient = PrismaClient | Prisma.TransactionClient;

/**
 * Config del motore. Estende `CalendarioPiattaforma`, così le funzioni che
 * hanno bisogno solo del calendario (`isOrarioLavorativo`, `minutiLavorativiTra`)
 * accettano il DTO senza che il DTO le costringa a dipendere da raggi e durate.
 */
export type DistribuzioneConfigDTO = CalendarioPiattaforma & {
  raggioStartM: number;
  stepM: number;
  raggioMaxM: number;
  intervalloMin: number;
};

/**
 * Default: primo anello 1 km, +1 km per round, un round all'ora, max 10 km,
 * calendario LUN-VEN 09-19 senza festivi.
 *
 * Valgono solo finché la riga singleton non esiste (o non è leggibile).
 */
export const DISTRIBUZIONE_DEFAULT: DistribuzioneConfigDTO = {
  raggioStartM: 1000,
  stepM: 1000,
  raggioMaxM: 10000,
  intervalloMin: 60,
  ...CALENDARIO_DEFAULT,
};

/**
 * Config distribuzione corrente: la riga singleton `distribuzione_config`
 * (fallback a `DISTRIBUZIONE_DEFAULT` se assente).
 *
 * Avvolto in React `cache()` → dedup per-request, NESSUNA cache persistente:
 * ogni modifica dall'admin si riflette al tick successivo.
 *
 * Fail-open su qualunque errore: la distribuzione non deve mai bloccarsi per un
 * blip del DB. Stesso principio dentro il calendario, dove un JSON malformato
 * ricade sui default invece che su "chiuso".
 */
export const getDistribuzioneConfig = cache(
  async (client: DistribuzioneConfigClient = prisma): Promise<DistribuzioneConfigDTO> => {
    try {
      const row = await client.distribuzioneConfig.findFirst({ where: { id: 'singleton' } });
      if (!row) return DISTRIBUZIONE_DEFAULT;
      return {
        raggioStartM: row.raggioStartM,
        stepM: row.stepM,
        raggioMaxM: row.raggioMaxM,
        intervalloMin: row.intervalloMin,
        orariSettimana: parseOrariSettimana(row.orariSettimana),
        festivi: parseFestivi(row.festivi),
      };
    } catch {
      return DISTRIBUZIONE_DEFAULT;
    }
  },
);
