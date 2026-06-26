import { describe, it, expect } from 'vitest';
import { routeSelection } from './document-scanner-modal';

describe('routeSelection', () => {
  it('immagine → apre editor', () => {
    expect(routeSelection(new File([], 'a.jpg', { type: 'image/jpeg' }))).toBe('editor');
    expect(routeSelection(new File([], 'a.png', { type: 'image/png' }))).toBe('editor');
  });
  it('PDF → editor (non più passthrough)', () => {
    const pdf = new File([new Uint8Array([1])], 'doc.pdf', { type: 'application/pdf' });
    expect(routeSelection(pdf)).toBe('editor');
  });
  it('null → noop', () => {
    expect(routeSelection(null)).toBe('noop');
  });
});
