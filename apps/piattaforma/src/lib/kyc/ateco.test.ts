import { describe, it, expect } from 'vitest';
import { normalizeAteco, isAtecoAllowed } from './ateco';

const allowed = [
  { companyType: 'DEALER' as const, code: '4511', active: true },
  { companyType: 'DEALER' as const, code: '453', active: true },
  { companyType: 'AGENZIA' as const, code: '8211', active: true },
  { companyType: 'DEALER' as const, code: '9999', active: false },
];

describe('normalizeAteco', () => {
  it('rimuove punti e spazi', () => {
    expect(normalizeAteco('45.11.01')).toBe('451101');
    expect(normalizeAteco(' 45.3 ')).toBe('453');
  });
});

describe('isAtecoAllowed', () => {
  it('match per prefisso sul tipo azienda', () => {
    expect(isAtecoAllowed('45.11.01', 'DEALER', allowed)).toBe(true);
    expect(isAtecoAllowed('45.31', 'DEALER', allowed)).toBe(true);
  });
  it('non matcha codici di un altro tipo azienda', () => {
    expect(isAtecoAllowed('82.11', 'DEALER', allowed)).toBe(false);
    expect(isAtecoAllowed('82.11', 'AGENZIA', allowed)).toBe(true);
  });
  it('ignora i codici disattivati e gli ATECO vuoti', () => {
    expect(isAtecoAllowed('99.99', 'DEALER', allowed)).toBe(false);
    expect(isAtecoAllowed(undefined, 'DEALER', allowed)).toBe(false);
  });
});
