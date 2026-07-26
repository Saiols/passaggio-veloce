import 'server-only';
import { prisma } from '@pv/db';

/**
 * Clausola 3, fascia (b): le variazioni oltre il 20% (o strutturali) sono
 * comunicate con 30 giorni di preavviso e richiedono la RIACCETTAZIONE
 * esplicita dell'Utente prima dell'entrata in vigore.
 *
 * Da qui discende il gate: una tariffa rilevante già ENTRATA IN VIGORE non è
 * applicabile a chi non l'ha riaccettata, quindi a quell'Utente non si possono
 * far partire nuove pratiche — sarebbero prezzate con condizioni che non ha
 * accettato. Non è una sospensione: l'account resta accessibile, i wallet
 * incassabili, le pratiche in corso proseguono alle vecchie condizioni, e la
 * strada per uscirne è a un clic (o il recesso senza penali, che la stessa
 * clausola concede).
 *
 * ⚠️ Il gate scatta DALL'entrata in vigore, non dalla comunicazione. Durante i
 * 30 giorni di preavviso l'Utente lavora normalmente: bloccarlo prima
 * significherebbe trasformare un preavviso in un ultimatum.
 */

export type RiaccettazionePendente = {
  tariffaId: string;
  efficaceDal: Date;
};

/**
 * La variazione rilevante, già in vigore, che questa azienda non ha ancora
 * riaccettato. `null` se non ce n'è — che è il caso normale.
 */
export async function getRiaccettazionePendente(
  companyId: string,
  now: Date = new Date(),
): Promise<RiaccettazionePendente | null> {
  const tariffa = await prisma.tariffaPiattaforma.findFirst({
    where: {
      efficaceDal: { lte: now },
      annullataAt: null,
      richiedeRiaccettazione: true,
    },
    orderBy: [{ efficaceDal: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, efficaceDal: true },
  });
  if (!tariffa) return null;

  // Solo la tariffa CORRENTE conta. Una variazione rilevante superata da una
  // successiva non va più riaccettata: chiedere il consenso a condizioni che
  // non sono più in vigore non tutela nessuno, e lascerebbe utenti bloccati
  // per sempre da una tariffa storica.
  const corrente = await prisma.tariffaPiattaforma.findFirst({
    where: { efficaceDal: { lte: now }, annullataAt: null },
    orderBy: [{ efficaceDal: 'desc' }, { createdAt: 'desc' }],
    select: { id: true },
  });
  if (corrente?.id !== tariffa.id) return null;

  const gia = await prisma.riaccettazioneTariffa.findUnique({
    where: { companyId_tariffaId: { companyId, tariffaId: tariffa.id } },
    select: { id: true },
  });
  return gia ? null : { tariffaId: tariffa.id, efficaceDal: tariffa.efficaceDal };
}

/**
 * Messaggio unico del gate: lo usano sia la creazione pratica (broker) sia
 * l'accettazione (agenzia). Deve dire cosa fare, non solo cosa è vietato — e
 * NON deve dire «sospeso», che contraddirebbe la clausola 12.5.
 */
export const ERRORE_RIACCETTAZIONE_PENDENTE =
  'Le condizioni economiche sono cambiate: confermale in /tariffe-aggiornate per inviare o accettare nuove pratiche. Le pratiche già in corso restano alle condizioni precedenti.';

/** Registra la riaccettazione. Idempotente: riaccettare due volte non è un errore. */
export async function registraRiaccettazione(input: {
  companyId: string;
  tariffaId: string;
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await prisma.riaccettazioneTariffa.upsert({
    where: {
      companyId_tariffaId: { companyId: input.companyId, tariffaId: input.tariffaId },
    },
    create: {
      companyId: input.companyId,
      tariffaId: input.tariffaId,
      userId: input.userId,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
    update: {},
  });
}
