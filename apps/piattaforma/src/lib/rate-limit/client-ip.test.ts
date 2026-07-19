import { describe, it, expect } from 'vitest';
import { getClientIp } from './client-ip';

function hdrs(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

describe('getClientIp', () => {
  it('preferisce x-real-ip quando presente', () => {
    const ip = getClientIp(hdrs({ 'x-real-ip': '5.5.5.5', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }));
    expect(ip).toBe('5.5.5.5');
  });

  it('senza x-real-ip usa l\'ULTIMO valore di x-forwarded-for (non il primo, spoofabile dal client)', () => {
    const ip = getClientIp(hdrs({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 9.9.9.9' }));
    expect(ip).toBe('9.9.9.9');
  });

  it('gestisce spazi/CSV sporca', () => {
    const ip = getClientIp(hdrs({ 'x-forwarded-for': ' 1.1.1.1 ,  9.9.9.9  ' }));
    expect(ip).toBe('9.9.9.9');
  });

  it('fallback a "unknown" se nessun header è presente', () => {
    const ip = getClientIp(hdrs({}));
    expect(ip).toBe('unknown');
  });
});
