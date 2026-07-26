import { cache } from 'react';
import { prisma } from '@pv/db';
import { rowToTariffario, DEFAULT_TARIFFARIO, type Tariffario } from '@/lib/pricing';

/**
 * Filtro della riga IN VIGORE a un dato istante: già efficace e non annullata.
 *
 * Unico posto in cui è scritta la regola «quale tariffa si applica adesso».
 * Prima era il flag `attivo`; dalla clausola 3 (variazioni con preavviso) è la
 * data di efficacia a comandare, e una riga con `efficaceDal` nel futuro è una
 * variazione programmata che NON deve toccare né i prezzi mostrati né le
 * pratiche in corso.
 */
function whereInVigore(now: Date) {
  return { efficaceDal: { lte: now }, annullataAt: null };
}

const ORDER_PIU_RECENTE = [{ efficaceDal: 'desc' as const }, { createdAt: 'desc' as const }];

/**
 * Tariffario in vigore adesso. Avvolto in React `cache()` → dedup per-request,
 * NESSUNA cache persistente: una variazione che entra in vigore si riflette
 * subito, senza attendere una rivalidazione (anche sui bot).
 *
 * Fail-open su qualunque errore della query (non solo riga assente): questa
 * funzione è usata anche dalla landing pubblica e da /llms.txt, che prima
 * erano statici (nessun DB coinvolto). Un blip del DB non deve tradursi in
 * un 500 su superfici pubbliche/SEO.
 */
export const getTariffarioCorrente = cache(async (): Promise<Tariffario> => {
  try {
    return rowToTariffario(
      await prisma.tariffaPiattaforma.findFirst({
        where: whereInVigore(new Date()),
        orderBy: ORDER_PIU_RECENTE,
      }),
    );
  } catch {
    return DEFAULT_TARIFFARIO;
  }
});

export type RigaTariffa = Awaited<
  ReturnType<typeof prisma.tariffaPiattaforma.findFirst>
>;

/**
 * La riga in vigore, per intero. Serve a chi deve sapere non solo QUANTO ma
 * anche QUALE tariffa ha applicato (lo snapshot sulla pratica, la
 * riaccettazione della clausola 3), non solo i sei importi.
 */
export async function getRigaTariffaCorrente(now: Date = new Date()): Promise<RigaTariffa> {
  return prisma.tariffaPiattaforma.findFirst({
    where: whereInVigore(now),
    orderBy: ORDER_PIU_RECENTE,
  });
}

/**
 * La variazione PROGRAMMATA e non ancora in vigore, se c'è.
 *
 * Ne esiste al più una utile: se l'admin ne programma una seconda, quella
 * successiva vince (è più recente) e la precedente va annullata — se ne occupa
 * l'action di salvataggio. Qui si restituisce la più imminente, che è quella
 * che l'Utente vedrà annunciata.
 */
export async function getTariffaProgrammata(now: Date = new Date()): Promise<RigaTariffa> {
  return prisma.tariffaPiattaforma.findFirst({
    where: { efficaceDal: { gt: now }, annullataAt: null },
    orderBy: [{ efficaceDal: 'asc' }, { createdAt: 'asc' }],
  });
}
