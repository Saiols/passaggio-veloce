import { describe, it, expect } from 'vitest';
import { verifyTwoFactor, hashBackupCodes } from './totp';

describe('verifyTwoFactor', () => {
  it('returns ok via TOTP when the injected verifier accepts the code', async () => {
    const r = await verifyTwoFactor({ secret: 'SECRET', backupCodeHashes: [] }, '123456', () => true);
    expect(r).toEqual({ ok: true, consumedBackupIndex: null });
  });

  it('falls back to a backup code and reports the consumed index', async () => {
    const hashes = await hashBackupCodes(['AAAA-BBBB', 'CCCC-DDDD']);
    const r = await verifyTwoFactor({ secret: 'SECRET', backupCodeHashes: hashes }, 'cccc-dddd', () => false);
    expect(r.ok).toBe(true);
    expect(r.consumedBackupIndex).toBe(1);
  });

  it('rejects an empty code', async () => {
    const r = await verifyTwoFactor({ secret: 'SECRET', backupCodeHashes: [] }, '   ', () => true);
    expect(r).toEqual({ ok: false, consumedBackupIndex: null });
  });

  it('rejects an invalid code (no TOTP, no backup match)', async () => {
    const hashes = await hashBackupCodes(['AAAA-BBBB']);
    const r = await verifyTwoFactor({ secret: 'SECRET', backupCodeHashes: hashes }, 'ZZZZ-9999', () => false);
    expect(r).toEqual({ ok: false, consumedBackupIndex: null });
  });

  it('rejects when secret missing and no backup match', async () => {
    const r = await verifyTwoFactor({ secret: null, backupCodeHashes: [] }, '123456', () => true);
    expect(r).toEqual({ ok: false, consumedBackupIndex: null });
  });
});
