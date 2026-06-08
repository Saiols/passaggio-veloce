import { describe, it, expect } from 'vitest';
import { routeSelection } from './document-scanner-modal';

describe('routeSelection', () => {
  it('immagine → apre editor', () => {
    expect(routeSelection(new File([], 'a.jpg', { type: 'image/jpeg' }))).toBe('editor');
    expect(routeSelection(new File([], 'a.png', { type: 'image/png' }))).toBe('editor');
  });
  it('pdf → passa diretto', () => {
    expect(routeSelection(new File([], 'a.pdf', { type: 'application/pdf' }))).toBe('passthrough');
  });
  it('null → noop', () => {
    expect(routeSelection(null)).toBe('noop');
  });
});
