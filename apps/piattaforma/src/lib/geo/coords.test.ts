import { describe, it, expect } from 'vitest';
import { parseCoords, distanceKm } from './coords';

describe('parseCoords', () => {
  it('parse-a stringhe valide', () => {
    expect(parseCoords('45.4642', '9.19')).toEqual({ lat: 45.4642, lng: 9.19 });
  });
  it('null se non numerico o vuoto', () => {
    expect(parseCoords('', '')).toBeNull();
    expect(parseCoords('abc', '9')).toBeNull();
    expect(parseCoords(null, null)).toBeNull();
  });
  it('null se fuori range', () => {
    expect(parseCoords('91', '9')).toBeNull();
    expect(parseCoords('45', '181')).toBeNull();
  });
});

describe('distanceKm', () => {
  it('0 su punto identico', () => {
    expect(distanceKm({ lat: 45, lng: 9 }, { lat: 45, lng: 9 })).toBe(0);
  });
  it('simmetrica', () => {
    const a = { lat: 45.4642, lng: 9.19 }; // Milano
    const b = { lat: 45.0703, lng: 7.6869 }; // Torino
    expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 6);
  });
  it('Milano–Torino ~ 126 km (±3)', () => {
    const d = distanceKm({ lat: 45.4642, lng: 9.19 }, { lat: 45.0703, lng: 7.6869 });
    expect(d).toBeGreaterThan(123);
    expect(d).toBeLessThan(129);
  });
  it('~1 km a piccola scala', () => {
    // ~0.009° di latitudine ≈ 1 km
    const d = distanceKm({ lat: 45.0, lng: 9.0 }, { lat: 45.009, lng: 9.0 });
    expect(d).toBeGreaterThan(0.9);
    expect(d).toBeLessThan(1.1);
  });
});
