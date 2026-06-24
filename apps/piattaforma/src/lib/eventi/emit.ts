import 'server-only';
import type { Prisma, PrismaClient } from '@pv/db';
import { EVENTO, type EventoPraticaInput } from './tipi';

/** Accetta sia il client globale sia una transazione. */
type EventoClient = PrismaClient | Prisma.TransactionClient;

/** Crea una riga EventoPratica (una modale per la controparte). */
export async function emitEventoPratica(client: EventoClient, input: EventoPraticaInput): Promise<void> {
  await client.eventoPratica.create({
    data: {
      praticaId: input.praticaId ?? null,
      targetCompanyId: input.targetCompanyId,
      targetSedeId: input.targetSedeId ?? null,
      tipo: input.tipo,
      titolo: input.titolo,
      testo: input.testo,
      ctaLabel: input.ctaLabel ?? null,
      ctaHref: input.ctaHref ?? null,
    },
  });
}

/** Crea più eventi (es. "nuova pratica" a tutte le agenzie selezionate). */
export async function emitEventiPratica(
  client: EventoClient,
  inputs: readonly EventoPraticaInput[],
): Promise<void> {
  if (inputs.length === 0) return;
  await client.eventoPratica.createMany({
    data: inputs.map((input) => ({
      praticaId: input.praticaId ?? null,
      targetCompanyId: input.targetCompanyId,
      targetSedeId: input.targetSedeId ?? null,
      tipo: input.tipo,
      titolo: input.titolo,
      testo: input.testo,
      ctaLabel: input.ctaLabel ?? null,
      ctaHref: input.ctaHref ?? null,
    })),
  });
}

/**
 * Quando un'agenzia accetta (o la pratica avanza), i "nuova pratica" ancora non
 * visti delle ALTRE agenzie per quella pratica non sono più rilevanti: li
 * marchiamo visti così la modale non mostra lavoro non più disponibile.
 */
export async function dismissNuovaPraticaEventi(
  client: EventoClient,
  praticaId: string,
  exceptCompanyId?: string,
): Promise<void> {
  await client.eventoPratica.updateMany({
    where: {
      praticaId,
      tipo: EVENTO.NUOVA_PRATICA,
      seenAt: null,
      ...(exceptCompanyId ? { targetCompanyId: { not: exceptCompanyId } } : {}),
    },
    data: { seenAt: new Date() },
  });
}
