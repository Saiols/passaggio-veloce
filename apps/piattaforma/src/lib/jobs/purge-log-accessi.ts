import 'server-only';
import { prisma } from '@pv/db';
import { LOG_RETENTION_GIORNI } from '@/lib/audit/log-accessi';

export type PurgeLogAccessiResult = {
  eliminati: number;
};

/**
 * Applica la retention di 24 mesi al log accessi.
 *
 * Senza questo job la privacy policy direbbe una cosa falsa: dichiara «24
 * mesi» e senza cancellazione i log resterebbero per sempre. Un registro di
 * accessi è a sua volta un archivio di dati personali — chi, quando, da quale
 * IP — e conservarlo oltre il necessario è la violazione, non la tutela.
 *
 * `deleteMany` per sola data, servito dall'indice su `createdAt`: nessun
 * batching, perché la cancellazione è per intervallo e non riga per riga come
 * l'anonimizzazione degli utenti (che deve riscrivere ogni record).
 *
 * Il cutoff è calcolato dalla stessa costante che il testo della policy cita:
 * cambiarne uno solo dei due li farebbe divergere in silenzio.
 */
export async function purgeLogAccessi(now: Date = new Date()): Promise<PurgeLogAccessiResult> {
  const cutoff = new Date(now.getTime() - LOG_RETENTION_GIORNI * 24 * 60 * 60 * 1000);

  const { count } = await prisma.logAccesso.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  return { eliminati: count };
}
