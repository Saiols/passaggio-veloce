import { describe, it, expect } from 'vitest';
import { documentoDownloadName, labelDocumentoTipo, labelDocumentoOwner } from './labels';

describe('labelDocumentoTipo', () => {
  it('mappa i tipi noti a etichette leggibili', () => {
    expect(labelDocumentoTipo('LIBRETTO_CIRCOLAZIONE')).toBe('Libretto circolazione');
    expect(labelDocumentoTipo('FOGLIO_COMPLEMENTARE')).toBe('Foglio complementare');
    expect(labelDocumentoTipo('CERTIFICATO_PROPRIETA')).toBe('Certificato di proprietà');
  });

  it('fa fallback al valore grezzo per tipi sconosciuti', () => {
    expect(labelDocumentoTipo('QUALCOSA_DI_NUOVO')).toBe('QUALCOSA_DI_NUOVO');
  });
});

describe('labelDocumentoOwner', () => {
  it('mappa gli owner e ritorna stringa vuota per null', () => {
    expect(labelDocumentoOwner('VENDITORE')).toBe('venditore');
    expect(labelDocumentoOwner(null)).toBe('');
  });
});

describe('documentoDownloadName', () => {
  it('download singolo: "<codice> - <label>", senza indice', () => {
    expect(
      documentoDownloadName(
        { tipo: 'CERTIFICATO_PROPRIETA', owner: null, originalFilename: 'cdp.pdf' },
        { codicePratica: 'PV-2026-00042' },
      ),
    ).toBe('PV-2026-00042 - Certificato di proprietà.pdf');
  });

  it('include l\'owner quando presente', () => {
    expect(
      documentoDownloadName(
        { tipo: 'CI_FRONTE', owner: 'VENDITORE', originalFilename: 'scan.JPG' },
        { codicePratica: 'PV-2026-00042' },
      ),
    ).toBe('PV-2026-00042 - CI fronte - venditore.jpg');
  });

  it('senza codice pratica usa "documento" come base e non espone il nome originale', () => {
    const name = documentoDownloadName({
      tipo: 'PASSAPORTO',
      owner: 'VENDITORE',
      originalFilename: 'passaporto-mario-rossi-riservato.jpeg',
    });
    expect(name).toBe('documento - Passaporto - venditore.jpeg');
    expect(name).not.toContain('mario-rossi');
  });
});
