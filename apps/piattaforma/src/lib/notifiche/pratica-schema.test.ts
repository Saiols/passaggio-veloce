import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Contratto di schema: la pratica sa CHI l'ha creata e CHI l'ha accettata.
 *
 * Senza queste colonne le email successive alla creazione non hanno modo di
 * risalire all'operatore e ricadono sull'admin dell'azienda madre — il bug che
 * questa feature chiude. I mock di Prisma nei test non se ne accorgerebbero.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(here, '../../../../../packages/db/prisma/schema.prisma');

function modelBlock(schema: string, model: string): string {
  const match = schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`model ${model} non trovato in schema.prisma`);
  return match[0];
}

const schema = readFileSync(SCHEMA_PATH, 'utf8');

describe('schema Pratica — tracciabilità di chi lavora la pratica', () => {
  const block = modelBlock(schema, 'Pratica');

  it('registra chi ha creato la pratica', () => {
    expect(block).toContain('creatoDaUserId');
  });

  it('registra chi ha accettato la pratica', () => {
    expect(block).toContain('accettataDaUserId');
  });

  // Le asserzioni ignorano la spaziatura: `prisma format` riallinea le colonne.
  it('sono relazioni vere verso User, non uuid nudi', () => {
    expect(block).toMatch(/creatoDa\s+User\?\s+@relation\("PraticheCreate"/);
    expect(block).toMatch(/accettataDa\s+User\?\s+@relation\("PraticheAccettate"/);
  });

  it('la cancellazione di un utente non porta via la pratica', () => {
    expect(block).toMatch(/@relation\("PraticheCreate"[^)]*onDelete: SetNull/);
    expect(block).toMatch(/@relation\("PraticheAccettate"[^)]*onDelete: SetNull/);
  });
});

describe('schema User — relazioni inverse', () => {
  const block = modelBlock(schema, 'User');

  it('espone le pratiche create e quelle accettate', () => {
    expect(block).toContain('PraticheCreate');
    expect(block).toContain('PraticheAccettate');
  });
});
