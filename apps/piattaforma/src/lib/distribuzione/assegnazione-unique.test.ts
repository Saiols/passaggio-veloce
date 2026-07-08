import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Contratto di schema: l'assegnataria di una pratica è la SEDE, non la madre.
 *
 * Da quando la distribuzione contatta TUTTE le sedi in zona (rimosso
 * `dedupeByMadre`), due filiali della stessa azienda madre possono essere
 * assegnate nello STESSO round: `agenziaId` (madre) si ripete per costruzione.
 * Se il vincolo unico resta su `(praticaId, agenziaId, round)`, il secondo
 * `praticaAssegnazione.create()` esplode con P2002, la transazione di
 * `avviaRound1ForPratica` fa rollback e la creazione pratica va in 500.
 *
 * Questo test blocca esattamente quel disallineamento codice↔DB: i mock di
 * `tick.test.ts` non applicano i vincoli, quindi da soli non lo intercettano.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(here, '../../../../../packages/db/prisma/schema.prisma');

function modelBlock(schema: string, model: string): string {
  const match = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`model ${model} non trovato in schema.prisma`);
  return match[0];
}

describe('schema PraticaAssegnazione', () => {
  const block = modelBlock(readFileSync(SCHEMA_PATH, 'utf8'), 'PraticaAssegnazione');

  it('ha il vincolo unico per SEDE (una assegnazione per pratica/sede/round)', () => {
    expect(block).toContain('@@unique([praticaId, sedeId, round])');
  });

  it('NON ha il vincolo unico per madre (vieterebbe due sedi della stessa madre nel round)', () => {
    expect(block).not.toContain('@@unique([praticaId, agenziaId, round])');
  });
});
