// @vitest-environment jsdom
// jsdom serve perché il modulo registra i listener visibilitychange/pageshow
// solo sotto `typeof window !== 'undefined'` (guardia SSR).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getWorker, disposeWorker } from './scanner-client';

// jsdom non implementa Worker → stub minimale che traccia le istanze create e
// le terminazioni. getWorker() usa `new Worker(...)`: essendo lazy, non gira
// all'import ma solo quando lo chiamiamo nei test, dopo lo stubGlobal.
const created: FakeWorker[] = [];
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  constructor() {
    created.push(this);
  }
  postMessage(): void {}
  terminate(): void {
    this.terminated = true;
  }
}
vi.stubGlobal('Worker', FakeWorker);

describe('scanner-client — resilienza worker (iOS background)', () => {
  beforeEach(() => {
    disposeWorker();
    created.length = 0;
  });

  it('disposeWorker termina il worker e ne forza la ricreazione (istanza nuova)', () => {
    const w1 = getWorker();
    expect(created).toHaveLength(1);

    disposeWorker();
    expect(created[0].terminated).toBe(true);

    const w2 = getWorker();
    expect(created).toHaveLength(2);
    expect(w2).not.toBe(w1); // NON riusa il worker morto
  });

  it('getWorker è un singleton finché non si dispone', () => {
    const a = getWorker();
    const b = getWorker();
    expect(a).toBe(b);
    expect(created).toHaveLength(1);
  });

  it('al ritorno in foreground (visibilitychange → visible) butta il worker morto', () => {
    getWorker();
    expect(created).toHaveLength(1);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(created[0].terminated).toBe(true); // disposto dal listener
    getWorker(); // ricrea lazy
    expect(created).toHaveLength(2);
  });

  it('visibilitychange verso hidden NON tocca il worker', () => {
    getWorker();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(created[0].terminated).toBe(false);
    expect(created).toHaveLength(1);
  });
});
