import 'server-only';
import { prisma } from '@pv/db';

export type TipoRegistrati = { tot: number; daLista: number; organici: number };
export type PlatformRegistrationStats = {
  broker: TipoRegistrati; // Company.type = DEALER
  agenzia: TipoRegistrati; // Company.type = AGENZIA
};

/**
 * Conteggi informativi dei registrati sulla piattaforma per tipo, con split
 * "da lista CRM" (Company con almeno un CrmContact agganciato — relazione
 * `crmContactMatches`) vs "organici". NON è una metrica di conversione: è un
 * dato di contesto per la dashboard CRM.
 *
 * Due groupBy: totali (deletedAt: null) e da-lista (+ crmContactMatches.some).
 * organici = max(0, tot - daLista) — guard difensivo, matematicamente daLista
 * è un sottoinsieme dei totali.
 */
export async function getPlatformRegistrationStats(): Promise<PlatformRegistrationStats> {
  const [totali, daLista] = await Promise.all([
    prisma.company.groupBy({
      by: ['type'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.company.groupBy({
      by: ['type'],
      where: { deletedAt: null, crmContactMatches: { some: {} } },
      _count: { _all: true },
    }),
  ]);

  const countFor = (
    rows: Array<{ type: string; _count: { _all: number } }>,
    t: 'DEALER' | 'AGENZIA',
  ) => rows.find((r) => r.type === t)?._count._all ?? 0;

  const build = (t: 'DEALER' | 'AGENZIA'): TipoRegistrati => {
    const tot = countFor(totali, t);
    const dl = countFor(daLista, t);
    return { tot, daLista: dl, organici: Math.max(0, tot - dl) };
  };

  return { broker: build('DEALER'), agenzia: build('AGENZIA') };
}
