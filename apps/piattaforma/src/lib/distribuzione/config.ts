import { cache } from 'react';
import { prisma, type Prisma, type PrismaClient } from '@pv/db';
import type { GiornoSettimana } from './ore-lavorative';

/** Accetta sia il client globale sia una transazione. */
type DistribuzioneConfigClient = PrismaClient | Prisma.TransactionClient;

const GIORNI_VALIDI: readonly GiornoSettimana[] = ['LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB', 'DOM'];

export type DistribuzioneConfigDTO = {
  raggioStartM: number;
  stepM: number;
  raggioMaxM: number;
  intervalloMin: number;
  orarioInizio: string;
  orarioFine: string;
  giorni: GiornoSettimana[];
};

/**
 * Default: primo anello 1 km, +1 km per round, un round all'ora, max 10 km,
 * LUN-VEN 09-19. Fino a 10 round, che coprono ~una giornata lavorativa.
 *
 * Tutti e quattro i parametri di raggio/tempo sono editabili da
 * `/admin/distribuzione`: questi valori valgono solo finché la riga singleton
 * non esiste (o non è leggibile).
 */
export const DISTRIBUZIONE_DEFAULT: DistribuzioneConfigDTO = {
  raggioStartM: 1000,
  stepM: 1000,
  raggioMaxM: 10000,
  intervalloMin: 60,
  orarioInizio: '09:00',
  orarioFine: '19:00',
  giorni: ['LUN', 'MAR', 'MER', 'GIO', 'VEN'],
};

/**
 * Converte il CSV persistito (`DistribuzioneConfig.giorni`) in un array di
 * `GiornoSettimana`. Difensivo: scarta token vuoti/non riconosciuti invece di
 * lanciare — una riga config malformata non deve far crashare la distribuzione.
 */
export function parseGiorni(raw: string): GiornoSettimana[] {
  return raw
    .split(',')
    .map((token) => token.trim().toUpperCase())
    .filter((token): token is GiornoSettimana =>
      (GIORNI_VALIDI as readonly string[]).includes(token),
    );
}

/**
 * Config distribuzione corrente: la riga singleton `distribuzione_config`
 * (fallback a `DISTRIBUZIONE_DEFAULT` se assente).
 *
 * Avvolto in React `cache()` → dedup per-request, NESSUNA cache persistente:
 * ogni modifica dall'admin (raggio max, orari) si riflette subito al tick
 * successivo. Stesso pattern di `getTariffarioCorrente`.
 *
 * Fail-open su qualunque errore della query: la distribuzione non deve mai
 * bloccarsi per un blip del DB, usa i default finché il DB torna disponibile.
 *
 * `client` opzionale: passa la transazione (`tx`) quando chiamata dentro una
 * `$transaction` (es. `tickPratica`), altrimenti usa il client globale.
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
        orarioInizio: row.orarioInizio,
        orarioFine: row.orarioFine,
        giorni: parseGiorni(row.giorni),
      };
    } catch {
      return DISTRIBUZIONE_DEFAULT;
    }
  },
);
