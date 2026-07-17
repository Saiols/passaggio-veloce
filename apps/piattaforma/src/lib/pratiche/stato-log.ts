import 'server-only';
import type { Prisma, PrismaClient, PraticaStato } from '@pv/db';

type StatoLogClient = PrismaClient | Prisma.TransactionClient;

/** Costanti app-level (finiscono in meta.tipoEvento). Nessun enum DB. */
export const STATO_EVENTO = {
  SUBMIT: 'SUBMIT',
  ROUND_ADVANCE: 'ROUND_ADVANCE',
  ESCALATION: 'ESCALATION',
  ACCEPT: 'ACCEPT',
  ADMIN_ASSIGN: 'ADMIN_ASSIGN',
  PROCESS: 'PROCESS',
  SIGN: 'SIGN',
  CANCEL: 'CANCEL',
  RECIRCULATE: 'RECIRCULATE',
} as const;

export type StatoEvento = (typeof STATO_EVENTO)[keyof typeof STATO_EVENTO];

/**
 * Registra un cambio di stato nel log append-only. Va chiamato DENTRO la stessa
 * transazione della mutazione di stato, così l'audit è atomico con la
 * transizione. `client` accetta sia il client globale sia una tx.
 */
export async function logCambioStato(
  client: StatoLogClient,
  args: {
    praticaId: string;
    statoDa?: PraticaStato | null;
    statoA: PraticaStato;
    tipoEvento: StatoEvento;
    attoreUserId?: string | null;
    motivo?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await client.praticaStatoLog.create({
    data: {
      praticaId: args.praticaId,
      statoDa: args.statoDa ?? null,
      statoA: args.statoA,
      motivo: args.motivo ?? null,
      attoreUserId: args.attoreUserId ?? null,
      meta: { tipoEvento: args.tipoEvento, ...(args.meta ?? {}) } as Prisma.InputJsonValue,
    },
  });
}
