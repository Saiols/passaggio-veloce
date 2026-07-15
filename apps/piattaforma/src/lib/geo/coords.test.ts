import { describe, it, expect } from 'vitest';
import { parseCoords } from './coords';

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
