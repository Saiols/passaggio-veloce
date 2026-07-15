import { describe, it, expect } from 'vitest';
import { pointColor, DEALER_COLOR, AGENZIA_COLOR } from './mappa-colors';

describe('pointColor', () => {
  it('blu per i broker (DEALER)', () => {
    expect(pointColor('DEALER')).toBe(DEALER_COLOR);
  });
  it('arancione per le agenzie (AGENZIA)', () => {
    expect(pointColor('AGENZIA')).toBe(AGENZIA_COLOR);
  });
});
