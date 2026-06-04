import { describe, it, expect } from 'vitest';
import { documentToTextResult } from './google-documentai';

describe('documentToTextResult', () => {
  it('estrae testo e media confidence dalle pagine', () => {
    const doc = {
      text: 'CIAO MONDO',
      pages: [{ layout: { confidence: 0.8 } }, { layout: { confidence: 1.0 } }],
    };
    const r = documentToTextResult(doc);
    expect(r.text).toBe('CIAO MONDO');
    expect(r.pages).toBe(2);
    expect(r.confidence).toBeCloseTo(0.9, 5);
  });
  it('gestisce documento vuoto', () => {
    const r = documentToTextResult({});
    expect(r.text).toBe('');
    expect(r.pages).toBe(0);
    expect(r.confidence).toBe(0);
  });
});
