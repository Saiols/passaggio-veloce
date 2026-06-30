import { describe, it, expect } from 'vitest';
import {
  REGISTER_DRAFT_VERSION,
  REGISTER_DRAFT_MAX_AGE_MS,
  serializeRegisterDraft,
  parseRegisterDraft,
} from './register-draft';

const NOW = 1_700_000_000_000;

describe('register-draft envelope', () => {
  it('roundtrip: ciò che si serializza si riottiene parsando', () => {
    const state = { step: 3, data: { account: { email: 'a@b.it' } } };
    const json = serializeRegisterDraft(state, NOW);
    expect(parseRegisterDraft(json, NOW)).toEqual(state);
  });

  it('input null/non-JSON → null (mai lanciare)', () => {
    expect(parseRegisterDraft(null, NOW)).toBeNull();
    expect(parseRegisterDraft('{non json', NOW)).toBeNull();
    expect(parseRegisterDraft('"stringa"', NOW)).toBeNull();
  });

  it('versione diversa → null (invalida le bozze di vecchio schema)', () => {
    const stale = JSON.stringify({ version: REGISTER_DRAFT_VERSION + 1, savedAt: NOW, state: { step: 2 } });
    expect(parseRegisterDraft(stale, NOW)).toBeNull();
  });

  it('bozza scaduta → null', () => {
    const json = serializeRegisterDraft({ step: 1 }, NOW);
    const later = NOW + REGISTER_DRAFT_MAX_AGE_MS + 1;
    expect(parseRegisterDraft(json, later)).toBeNull();
    // ai limiti della finestra è ancora valida
    expect(parseRegisterDraft(json, NOW + REGISTER_DRAFT_MAX_AGE_MS)).toEqual({ step: 1 });
  });

  it('state assente/null → null', () => {
    const noState = JSON.stringify({ version: REGISTER_DRAFT_VERSION, savedAt: NOW });
    expect(parseRegisterDraft(noState, NOW)).toBeNull();
  });
});
