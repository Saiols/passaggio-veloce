import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { buildDocumentiZip, streamToBuffer, zipEntryName } from './zip';

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

describe('buildDocumentiZip', () => {
  it('impacchetta le entry con nome e contenuto', async () => {
    const buf = await buildDocumentiZip([
      { name: 'Rossi Srl - CI fronte.jpg', buffer: Buffer.from('aaa') },
      { name: 'Rossi Srl - Visura camerale.pdf', buffer: Buffer.from('bbb') },
    ]);
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files).sort()).toEqual([
      'Rossi Srl - CI fronte.jpg',
      'Rossi Srl - Visura camerale.pdf',
    ]);
    expect(await zip.file('Rossi Srl - CI fronte.jpg')!.async('string')).toBe('aaa');
  });

  it('uno zip senza entry non esplode', async () => {
    const zip = await JSZip.loadAsync(await buildDocumentiZip([]));
    expect(Object.keys(zip.files)).toEqual([]);
  });
});
