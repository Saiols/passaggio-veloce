import { describe, it, expect } from 'vitest';
import {
  serializeDraft,
  parseDraft,
  DRAFT_VERSION,
  DRAFT_MAX_AGE_MS,
} from './wizard-draft';

const NOW = 1_700_000_000_000;

describe('wizard-draft', () => {
  it('serialize → parse round-trip restituisce lo state', () => {
    const state = { step: 3, tipo: 'MINIVOLTURA', comune: 'Roma' };
    expect(parseDraft(serializeDraft(state, NOW), NOW)).toEqual(state);
  });

  it('parseDraft(null) → null', () => {
    expect(parseDraft(null, NOW)).toBeNull();
  });

  it('JSON malformato → null (mai crashare il wizard)', () => {
    expect(parseDraft('{non json', NOW)).toBeNull();
  });

  it('versione diversa → null (scarta bozze di vecchio schema)', () => {
    const json = JSON.stringify({ version: DRAFT_VERSION + 1, savedAt: NOW, state: { step: 2 } });
    expect(parseDraft(json, NOW)).toBeNull();
  });

  it('bozza scaduta → null', () => {
    const json = serializeDraft({ step: 2 }, NOW - DRAFT_MAX_AGE_MS - 1);
    expect(parseDraft(json, NOW)).toBeNull();
  });

  it('bozza entro la scadenza → state', () => {
    const json = serializeDraft({ step: 2 }, NOW - DRAFT_MAX_AGE_MS + 1000);
    expect(parseDraft(json, NOW)).toEqual({ step: 2 });
  });

  it('envelope senza state → null', () => {
    const json = JSON.stringify({ version: DRAFT_VERSION, savedAt: NOW });
    expect(parseDraft(json, NOW)).toBeNull();
  });
});
