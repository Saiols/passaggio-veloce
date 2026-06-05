import { describe, it, expect } from 'vitest';
import { NoopRegistroImpreseProvider } from './noop';

describe('NoopRegistroImpreseProvider', () => {
  it('ritorna sempre null (niente dati finti)', async () => {
    const p = new NoopRegistroImpreseProvider();
    expect(await p.lookupByPiva({ partitaIva: '12345678901' })).toBeNull();
  });
});
