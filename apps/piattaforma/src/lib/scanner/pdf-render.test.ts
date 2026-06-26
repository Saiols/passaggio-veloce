import { describe, it, expect } from 'vitest';
import { isPdfFile, clampPageIndex } from './pdf-render';

const file = (name: string, type: string) => new File([new Uint8Array([1, 2, 3])], name, { type });

describe('isPdfFile', () => {
  it('riconosce il mime application/pdf', () => {
    expect(isPdfFile(file('doc.bin', 'application/pdf'))).toBe(true);
  });
  it("riconosce l'estensione .pdf anche senza mime", () => {
    expect(isPdfFile(file('doc.PDF', ''))).toBe(true);
  });
  it('le immagini non sono PDF', () => {
    expect(isPdfFile(file('foto.jpg', 'image/jpeg'))).toBe(false);
  });
});

describe('clampPageIndex', () => {
  it('mantiene un indice valido', () => {
    expect(clampPageIndex(1, 3)).toBe(1);
  });
  it('clampa sotto 0', () => {
    expect(clampPageIndex(-2, 3)).toBe(0);
  });
  it("clampa oltre l'ultima pagina", () => {
    expect(clampPageIndex(9, 3)).toBe(2);
  });
  it('count 0 → 0', () => {
    expect(clampPageIndex(5, 0)).toBe(0);
  });
});
