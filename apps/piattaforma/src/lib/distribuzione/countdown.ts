import 'server-only';
import { prisma, Prisma } from '@pv/db';
import {
  addBusinessHours,
  firstOpeningAt,
  parseFasceOrarie,
  type Chiusura,
  type FasceByGiorno,
  type GiornoSettimana,
} from './ore-lavorative';

type AgenziaOrari = {
  fasce: FasceByGiorno;
  chiusure: Chiusura[];
};

/**
 * Carica orari + chiusure per un set di agenzie in un singolo roundtrip.
 */
export async function loadOrariPerAgenzie(
  agenziaIds: string[],
  tx?: Prisma.TransactionClient,
): Promise<Map<string, AgenziaOrari>> {
  const client = tx ?? prisma;

  if (agenziaIds.length === 0) return new Map();

  const [orari, chiusure] = await Promise.all([
    client.orariApertura.findMany({ where: { agenziaId: { in: agenziaIds } } }),
    client.chiusuraStraordinaria.findMany({ where: { agenziaId: { in: agenziaIds } } }),
  ]);

  const result = new Map<string, AgenziaOrari>();
  for (const id of agenziaIds) result.set(id, { fasce: {}, chiusure: [] });

  for (const o of orari) {
    const current = result.get(o.agenziaId);
    if (!current) continue;
    const giorno = o.giorno as GiornoSettimana;
    current.fasce[giorno] = parseFasceOrarie(o.fasceOrarie);
  }
  for (const c of chiusure) {
    const current = result.get(c.agenziaId);
    if (!current) continue;
    current.chiusure.push({ dataInizio: c.dataInizio, dataFine: c.dataFine });
  }
  return result;
}

/**
 * Calcola countdown (inizio + fine) per un'agenzia a partire da un istante di
 * invio. Se l'agenzia non ha alcuna fascia dichiarata, ritorna null per entrambi:
 * la pratica starà "sospesa" e l'admin vedrà l'agenzia come inattiva.
 */
export function computeCountdown(
  invioAt: Date,
  hoursDurata: number,
  orari: AgenziaOrari,
): { inizio: Date | null; fine: Date | null } {
  const hasAnyFascia = Object.values(orari.fasce).some(
    (list) => Array.isArray(list) && list.length > 0,
  );
  if (!hasAnyFascia) return { inizio: null, fine: null };

  try {
    const inizio = firstOpeningAt(invioAt, orari.fasce, orari.chiusure);
    const fine = addBusinessHours(inizio, hoursDurata, orari.fasce, orari.chiusure);
    return { inizio, fine };
  } catch {
    return { inizio: null, fine: null };
  }
}
