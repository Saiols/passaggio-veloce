import 'server-only';
import { prisma, Prisma } from '@pv/db';

export type OpzioneSede = { value: string; label: string };

/**
 * Le sedi dell'agenzia stessa, ristrette allo scope corrente: le uniche fra cui
 * ha senso che scelga, e le uniche che il filtro accetterà.
 */
export async function opzioniSedeProprie(scopeIds: string[]): Promise<OpzioneSede[]> {
  if (scopeIds.length === 0) return [];

  const sedi = await prisma.sede.findMany({
    where: { id: { in: scopeIds }, deletedAt: null },
    select: { id: true, nome: true, citta: true },
    orderBy: [{ citta: 'asc' }, { nome: 'asc' }],
  });

  return sedi.map((s) => ({ value: s.id, label: `${s.nome} (${s.citta})` }));
}

/**
 * Sedi agenzia che compaiono davvero nelle pratiche selezionate da
 * `wherePratiche` (caso broker).
 *
 * Passare lo where del solo scoping, SENZA il filtro sede già applicato:
 * altrimenti le opzioni si restringerebbero a quella selezionata e non si
 * potrebbe più cambiare scelta.
 */
export async function opzioniSedeAgenziaDaPratiche(
  wherePratiche: Prisma.PraticaWhereInput,
): Promise<OpzioneSede[]> {
  return conEtichettaAgenzia({
    type: 'AGENZIA',
    deletedAt: null,
    praticheAgenzia: { some: wherePratiche },
  });
}

/** Tutte le sedi agenzia della piattaforma (caso admin). */
export async function opzioniSedeAgenziaTutte(): Promise<OpzioneSede[]> {
  return conEtichettaAgenzia({ type: 'AGENZIA', deletedAt: null });
}

/**
 * Etichetta `Ragione sociale · Nome sede (Città)`: chi vede sedi di agenzie
 * diverse ha bisogno del nome dell'agenzia per distinguerle, e della città
 * perché anche all'interno della stessa agenzia due sedi possono avere lo
 * stesso nome (es. due "Sede centrale").
 */
async function conEtichettaAgenzia(where: Prisma.SedeWhereInput): Promise<OpzioneSede[]> {
  const sedi = await prisma.sede.findMany({
    where,
    select: { id: true, nome: true, citta: true, company: { select: { ragioneSociale: true } } },
    orderBy: [{ company: { ragioneSociale: 'asc' } }, { nome: 'asc' }],
  });

  return sedi.map((s) => ({
    value: s.id,
    label: `${s.company.ragioneSociale} · ${s.nome} (${s.citta})`,
  }));
}
