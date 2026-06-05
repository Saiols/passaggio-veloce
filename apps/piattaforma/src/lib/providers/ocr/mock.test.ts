import { describe, it, expect } from 'vitest';
import { MockOcrProvider } from './mock';

describe('MockOcrProvider.extractText', () => {
  it('ritorna testo deterministico e confidence in [0,1]', async () => {
    const p = new MockOcrProvider();
    const input = { buffer: Buffer.from('hello-doc'), mimeType: 'image/png' };
    const a = await p.extractText(input);
    const b = await p.extractText(input);
    expect(a.text).toBe(b.text); // deterministico
    expect(a.text.length).toBeGreaterThan(0);
    expect(a.confidence).toBeGreaterThanOrEqual(0);
    expect(a.confidence).toBeLessThanOrEqual(1);
    expect(a.pages).toBeGreaterThanOrEqual(1);
  });
});
