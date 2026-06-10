import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleKb, type DocInput } from '../src/lib/providers/chatbot/kb/assemble';

const here = dirname(fileURLToPath(import.meta.url));
// apps/piattaforma/scripts → su di 3 → repo root
const repoRoot = join(here, '..', '..', '..');
const docsDir = join(repoRoot, 'docs');
const outFile = join(here, '..', 'src', 'lib', 'providers', 'chatbot', 'kb', 'kb.generated.ts');

const docs: DocInput[] = readdirSync(docsDir)
  .filter((f) => f.endsWith('.md'))
  .map((f) => ({ name: f, content: readFileSync(join(docsDir, f), 'utf8') }));

const kb = assembleKb(docs);

const out = `// AUTO-GENERATO da apps/piattaforma/scripts/build-chatbot-kb.ts — NON modificare a mano.
// Rigenera con: pnpm --filter piattaforma kb:build
export const PUBLIC_KB = ${JSON.stringify(kb.public)};
export const CLIENTS_KB = ${JSON.stringify(kb.clients)};
export const INTERNAL_KB = ${JSON.stringify(kb.internal)};
`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, out, 'utf8');
console.log(
  `KB generata → public=${kb.public.length} clients=${kb.clients.length} internal=${kb.internal.length} char`,
);
