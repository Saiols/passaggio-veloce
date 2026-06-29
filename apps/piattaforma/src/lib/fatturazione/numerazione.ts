import 'server-only';
import type { ContatoreFiscaleTipo, Prisma } from '@pv/db';

/**
 * Prossimo numero progressivo per (idSoggetto, tipo, anno). Atomico: un singolo
 * statement INSERT … ON CONFLICT … RETURNING; nessun altro processo può leggere
 * o modificare il contatore nel mezzo. La riga inesistente parte da 1 (anche al
 * cambio anno → reset automatico, perché l'anno fa parte della chiave). Va
 * chiamato DENTRO la stessa transazione della create del documento: se la create
 * fallisce, l'incremento fa rollback e il numero non viene consumato.
 */
export async function prossimoContatore(
  tx: Prisma.TransactionClient,
  idSoggetto: string,
  tipo: ContatoreFiscaleTipo,
  anno: number,
): Promise<number> {
  const rows = await tx.$queryRaw<{ contatore: number }[]>`
    INSERT INTO "contatori_fiscali" ("id", "idSoggetto", "tipoDocumento", "anno", "contatore", "aggiornatoAt")
    VALUES (gen_random_uuid(), ${idSoggetto}, ${tipo}::"ContatoreFiscaleTipo", ${anno}, 1, now())
    ON CONFLICT ("idSoggetto", "tipoDocumento", "anno")
    DO UPDATE SET "contatore" = "contatori_fiscali"."contatore" + 1, "aggiornatoAt" = now()
    RETURNING "contatore"
  `;
  return rows[0].contatore;
}
