import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { buildPraticaZip, streamToBuffer, zipEntryName } from './zip';

describe('streamToBuffer', () => {
  it('drains a Readable into a single Buffer', async () => {
    const stream = Readable.from([Buffer.from('hello '), Buffer.from('world')]);
    const buf = await streamToBuffer(stream);
    expect(buf.toString()).toBe('hello world');
  });
});

describe('zipEntryName', () => {
  it('builds a readable name with owner and extension', () => {
    expect(
      zipEntryName({ tipo: 'CI_FRONTE', owner: 'VENDITORE', originalFilename: 'scan.jpg' }, 0),
    ).toBe('1-CI_FRONTE-VENDITORE.jpg');
  });

  it('omits owner when null and defaults extension to bin', () => {
    expect(
      zipEntryName({ tipo: 'LIBRETTO_CIRCOLAZIONE', owner: null, originalFilename: 'libretto' }, 2),
    ).toBe('3-LIBRETTO_CIRCOLAZIONE.bin');
  });
});

describe('buildPraticaZip', () => {
  it('produces a zip containing all entries', async () => {
    const buf = await buildPraticaZip([
      { name: 'a.txt', buffer: Buffer.from('AAA') },
      { name: 'b.txt', buffer: Buffer.from('BBB') },
    ]);
    const parsed = await JSZip.loadAsync(buf);
    expect(Object.keys(parsed.files).sort()).toEqual(['a.txt', 'b.txt']);
    expect(await parsed.files['a.txt'].async('string')).toBe('AAA');
  });
});
