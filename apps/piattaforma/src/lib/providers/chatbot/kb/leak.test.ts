import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleKb, type DocInput } from './assemble';

// Stringhe che NON devono mai comparire nella KB PUBBLICA (dato interno/finanziario).
const SENSITIVE_PUBLIC = ['margine', 'split', 'commission', 'penale', 'payout', '€50', '€25', 'puppeteer'];
// Per la KB CLIENTI: vietati margini/strategia/dev interni ('commissioni' è invece lecito lato cliente).
const SENSITIVE_CLIENTS = ['margine', 'split', 'puppeteer', 'stima costi'];

function realDocs(): DocInput[] {
  const dir = join(process.cwd(), '..', '..', 'docs'); // da apps/piattaforma → repo/docs
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ name: f, content: readFileSync(join(dir, f), 'utf8') }));
}

describe('anti-leak KB', () => {
  it('la KB public non contiene termini sensibili', () => {
    const lower = assembleKb(realDocs()).public.toLowerCase();
    for (const s of SENSITIVE_PUBLIC) {
      expect(lower, `"${s}" non deve comparire nella KB pubblica`).not.toContain(s);
    }
  });

  it('la KB clients non espone margini/strategia/dev interni', () => {
    const lower = assembleKb(realDocs()).clients.toLowerCase();
    for (const s of SENSITIVE_CLIENTS) {
      expect(lower, `"${s}" non deve comparire nella KB clienti`).not.toContain(s);
    }
  });
});
