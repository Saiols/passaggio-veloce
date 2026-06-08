import { describe, it, expect } from 'vitest';
import { isImageFile, scaledSize, outputFileName } from './process';

describe('scanner/process', () => {
  it('isImageFile riconosce jpg/png, esclude pdf', () => {
    expect(isImageFile(new File([], 'a.jpg', { type: 'image/jpeg' }))).toBe(true);
    expect(isImageFile(new File([], 'a.png', { type: 'image/png' }))).toBe(true);
    expect(isImageFile(new File([], 'a.pdf', { type: 'application/pdf' }))).toBe(false);
  });

  it('scaledSize ridimensiona oltre il lato max mantenendo le proporzioni', () => {
    expect(scaledSize(4000, 3000, 2500)).toEqual({ w: 2500, h: 1875 });
    expect(scaledSize(2000, 1000, 2500)).toEqual({ w: 2000, h: 1000 });
    expect(scaledSize(1000, 4000, 2500)).toEqual({ w: 625, h: 2500 });
  });

  it('outputFileName forza .jpg conservando il nome', () => {
    expect(outputFileName('Foto CI.png')).toBe('Foto CI.jpg');
    expect(outputFileName('doc')).toBe('doc.jpg');
    expect(outputFileName('a.b.jpeg')).toBe('a.b.jpg');
  });
});
