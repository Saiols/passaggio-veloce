import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, resetRateLimit } from './rate-limit';

describe('rate-limit', () => {
  beforeEach(() => {
    // Reset key di test all'inizio di ogni test
    resetRateLimit('test:k1');
    resetRateLimit('test:k2');
  });

  it('allows up to MAX_ATTEMPTS within window', () => {
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit('test:k1');
      expect(r.allowed).toBe(true);
    }
  });

  it('blocks after MAX_ATTEMPTS', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('test:k1');
    const r = checkRateLimit('test:k1');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('separate keys are independent', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('test:k1');
    const r1 = checkRateLimit('test:k1');
    const r2 = checkRateLimit('test:k2');
    expect(r1.allowed).toBe(false);
    expect(r2.allowed).toBe(true);
  });

  it('reset unblocks the key', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('test:k1');
    expect(checkRateLimit('test:k1').allowed).toBe(false);
    resetRateLimit('test:k1');
    expect(checkRateLimit('test:k1').allowed).toBe(true);
  });
});
