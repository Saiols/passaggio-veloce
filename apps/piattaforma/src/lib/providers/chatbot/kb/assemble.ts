export type Visibility = 'public' | 'clients' | 'internal';
export type Tier = 'public' | 'clients' | 'internal';

export type DocInput = { name: string; content: string };

/**
 * Estrae `chatbot_visibility` dal front-matter YAML iniziale.
 * Front-matter mancante, tag assente o valore non valido → 'internal'
 * (default sicuro: un doc nuovo non viene mai esposto per sbaglio).
 * Ritorna anche il body senza front-matter.
 */
export function parseFrontMatter(raw: string): { visibility: Visibility; body: string } {
  const fm = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!fm) return { visibility: 'internal', body: raw };
  const block = fm[1] ?? '';
  const body = raw.slice(fm[0].length);
  const m = /^[ \t]*chatbot_visibility[ \t]*:[ \t]*(["']?)(public|clients|internal)\1[ \t]*$/m.exec(block);
  const visibility = (m?.[2] as Visibility | undefined) ?? 'internal';
  return { visibility, body };
}

/** Visibilità incluse in un tier (modello cumulativo public ⊂ clients ⊂ internal). */
function includedFor(tier: Tier): ReadonlySet<Visibility> {
  if (tier === 'public') return new Set<Visibility>(['public']);
  if (tier === 'clients') return new Set<Visibility>(['public', 'clients']);
  return new Set<Visibility>(['public', 'clients', 'internal']);
}

/** Assembla le 3 KB cumulative dai docs. Funzione pura, testabile. */
export function assembleKb(docs: DocInput[]): Record<Tier, string> {
  const parsed = docs
    .map((d) => ({ name: d.name, ...parseFrontMatter(d.content) }))
    .sort((a, b) => a.name.localeCompare(b.name)); // ordine deterministico → caching stabile

  const build = (tier: Tier): string => {
    const inc = includedFor(tier);
    return parsed
      .filter((d) => inc.has(d.visibility))
      .map((d) => `# Documento: ${d.name}\n\n${d.body.trim()}`)
      .join('\n\n---\n\n');
  };

  return { public: build('public'), clients: build('clients'), internal: build('internal') };
}
