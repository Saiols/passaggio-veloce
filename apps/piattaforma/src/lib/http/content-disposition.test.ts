import { describe, it, expect } from 'vitest';
import { attachmentContentDisposition } from './content-disposition';

describe('attachmentContentDisposition', () => {
  // Caratterizzazione del bug: un header con char > U+00FF fa lanciare Response.
  it('(bug) il filename raw con char > U+00FF rompe new Response', () => {
    const raw = `attachment; filename="IT${String.fromCodePoint(0x20ac)}.xml"`;
    expect(() => new Response('x', { headers: { 'Content-Disposition': raw } })).toThrow(TypeError);
  });

  it('produce un header accettato da new Response anche con char non-Latin1', () => {
    const value = attachmentContentDisposition(`IT${String.fromCodePoint(0x20ac)}123_00007.xml`);
    expect(() => new Response('x', { headers: { 'Content-Disposition': value } })).not.toThrow();
  });

  it('il valore e\' interamente Latin-1 (nessun byte > 255)', () => {
    const value = attachmentContentDisposition('fattura ' + String.fromCodePoint(0x202f, 0x4e2d, 0x592e) + '.pdf');
    for (const ch of value) expect(ch.codePointAt(0) ?? 0).toBeLessThanOrEqual(0xff);
  });

  it('fornisce fallback ASCII tra virgolette + filename* UTF-8', () => {
    const value = attachmentContentDisposition(`IT${String.fromCodePoint(0x20ac)}.xml`);
    expect(value).toMatch(/^attachment; filename="IT_\.xml"; filename\*=UTF-8''/);
    expect(value).toContain('%E2%82%AC'); // euro in UTF-8 percent-encoded
  });

  it('lascia intatti i nomi gia ASCII', () => {
    expect(attachmentContentDisposition('fatture.csv')).toBe(
      "attachment; filename=\"fatture.csv\"; filename*=UTF-8''fatture.csv",
    );
  });
});
