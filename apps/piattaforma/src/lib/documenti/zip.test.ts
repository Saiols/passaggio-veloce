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
  it('usa la label leggibile del documento + indice per l\'unicità', () => {
    expect(
      zipEntryName({ tipo: 'CI_FRONTE', owner: 'VENDITORE', originalFilename: 'scan.jpg' }, 0),
    ).toBe('documento - CI fronte - venditore - 1.jpg');
  });

  it('omette owner quando null e usa bin come estensione di fallback', () => {
    expect(
      zipEntryName({ tipo: 'LIBRETTO_CIRCOLAZIONE', owner: null, originalFilename: 'libretto' }, 2),
    ).toBe('documento - Libretto circolazione - 3.bin');
  });

  it('antepone il numero pratica quando fornito', () => {
    expect(
      zipEntryName(
        { tipo: 'CI_FRONTE', owner: 'VENDITORE', originalFilename: 'scan.jpg' },
        0,
        { codicePratica: 'PV-2026-00042' },
      ),
    ).toBe('PV-2026-00042 - CI fronte - venditore - 1.jpg');
  });

  it('non espone MAI il nome file originale (privacy)', () => {
    const name = zipEntryName(
      { tipo: 'PATENTE', owner: 'ACQUIRENTE', originalFilename: 'foto-riservata-mario-rossi.png' },
      3,
      { codicePratica: 'PV-2026-00099' },
    );
    expect(name).toBe('PV-2026-00099 - Patente (fronte) - acquirente - 4.png');
    expect(name).not.toContain('foto-riservata');
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
