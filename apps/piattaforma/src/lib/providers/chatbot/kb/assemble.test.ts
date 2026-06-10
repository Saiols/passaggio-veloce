import { describe, it, expect } from 'vitest';
import { parseFrontMatter, assembleKb } from './assemble';

describe('parseFrontMatter', () => {
  it('estrae chatbot_visibility valido e rimuove il front-matter', () => {
    const r = parseFrontMatter('---\nchatbot_visibility: public\n---\nCiao mondo');
    expect(r.visibility).toBe('public');
    expect(r.body).toBe('Ciao mondo');
  });

  it('default internal quando manca il front-matter', () => {
    const r = parseFrontMatter('Nessun front-matter qui');
    expect(r.visibility).toBe('internal');
    expect(r.body).toBe('Nessun front-matter qui');
  });

  it('default internal quando il tag è assente nel front-matter', () => {
    const r = parseFrontMatter('---\ntitle: X\n---\nCorpo');
    expect(r.visibility).toBe('internal');
  });

  it('default internal quando il valore non è valido', () => {
    const r = parseFrontMatter('---\nchatbot_visibility: segreto\n---\nCorpo');
    expect(r.visibility).toBe('internal');
  });
});

describe('assembleKb', () => {
  const docs = [
    { name: 'pub.md', content: '---\nchatbot_visibility: public\n---\nINFO_PUBBLICA' },
    { name: 'cli.md', content: '---\nchatbot_visibility: clients\n---\nINFO_CLIENTI' },
    { name: 'int.md', content: '---\nchatbot_visibility: internal\n---\nINFO_INTERNA' },
    { name: 'notag.md', content: 'INFO_SENZA_TAG' },
  ];

  it('public contiene solo i doc public', () => {
    const kb = assembleKb(docs);
    expect(kb.public).toContain('INFO_PUBBLICA');
    expect(kb.public).not.toContain('INFO_CLIENTI');
    expect(kb.public).not.toContain('INFO_INTERNA');
    expect(kb.public).not.toContain('INFO_SENZA_TAG');
  });

  it('clients è cumulativo (public + clients)', () => {
    const kb = assembleKb(docs);
    expect(kb.clients).toContain('INFO_PUBBLICA');
    expect(kb.clients).toContain('INFO_CLIENTI');
    expect(kb.clients).not.toContain('INFO_INTERNA');
  });

  it('internal contiene tutto, incluso il doc senza tag', () => {
    const kb = assembleKb(docs);
    expect(kb.internal).toContain('INFO_PUBBLICA');
    expect(kb.internal).toContain('INFO_CLIENTI');
    expect(kb.internal).toContain('INFO_INTERNA');
    expect(kb.internal).toContain('INFO_SENZA_TAG');
  });
});
