import { describe, it, expect } from 'vitest';
import { docVeicoloMancante } from './veicolo-doc';

describe('docVeicoloMancante', () => {
  const full = { librettoFronte: true, librettoRetro: true, ocr: true, foglio: true };

  it('LIBRETTO completo (fronte+retro+OCR) → null', () => {
    expect(docVeicoloMancante({ tipoDocumento: 'LIBRETTO', ...full })).toBeNull();
  });

  it('LIBRETTO senza fronte → "libretto fronte"', () => {
    expect(
      docVeicoloMancante({ tipoDocumento: 'LIBRETTO', ...full, librettoFronte: false }),
    ).toBe('libretto fronte');
  });

  it('LIBRETTO con fronte ma senza retro → "libretto retro"', () => {
    expect(
      docVeicoloMancante({ tipoDocumento: 'LIBRETTO', ...full, librettoRetro: false }),
    ).toBe('libretto retro');
  });

  it('LIBRETTO con fronte+retro ma senza OCR → segnala OCR', () => {
    expect(docVeicoloMancante({ tipoDocumento: 'LIBRETTO', ...full, ocr: false })).toContain(
      'OCR',
    );
  });

  it('FOGLIO_COMPLEMENTARE con PDF → null (niente OCR/retro richiesti)', () => {
    expect(
      docVeicoloMancante({
        tipoDocumento: 'FOGLIO_COMPLEMENTARE',
        librettoFronte: false,
        librettoRetro: false,
        ocr: false,
        foglio: true,
      }),
    ).toBeNull();
  });

  it('FOGLIO_COMPLEMENTARE senza PDF → "foglio complementare"', () => {
    expect(
      docVeicoloMancante({
        tipoDocumento: 'FOGLIO_COMPLEMENTARE',
        librettoFronte: false,
        librettoRetro: false,
        ocr: false,
        foglio: false,
      }),
    ).toBe('foglio complementare');
  });
});
