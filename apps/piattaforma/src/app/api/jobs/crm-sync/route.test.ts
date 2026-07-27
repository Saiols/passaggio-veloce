import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const requireAdminOrCron = vi.fn();
const riconciliaTutto = vi.fn();
const syncCrmFromPlatform = vi.fn();
const chiamate: string[] = [];

vi.mock('@/lib/jobs/auth', () => ({
  requireAdminOrCron: (...a: unknown[]) => requireAdminOrCron(...a),
}));
vi.mock('@/lib/crm/match/apply', () => ({
  riconciliaTutto: (...a: unknown[]) => {
    chiamate.push('riconciliaTutto');
    return riconciliaTutto(...a);
  },
}));
vi.mock('@/lib/crm/sync', () => ({
  syncCrmFromPlatform: (...a: unknown[]) => {
    chiamate.push('syncCrmFromPlatform');
    return syncCrmFromPlatform(...a);
  },
}));

import { GET } from './route';

function req(headers: Record<string, string> = {}) {
  return new Request('https://app.test/api/jobs/crm-sync', { headers }) as unknown as import('next/server').NextRequest;
}

describe('GET/POST /api/jobs/crm-sync', () => {
  beforeEach(() => {
    requireAdminOrCron.mockReset();
    riconciliaTutto.mockReset();
    syncCrmFromPlatform.mockReset();
    chiamate.length = 0;
  });

  it('non autorizzato → risponde col guard, non tocca riconciliazione né sync', async () => {
    const forbidden = NextResponse.json({ error: 'forbidden' }, { status: 403 });
    requireAdminOrCron.mockResolvedValue(forbidden);
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(riconciliaTutto).not.toHaveBeenCalled();
    expect(syncCrmFromPlatform).not.toHaveBeenCalled();
  });

  it('autorizzato → esegue prima riconciliaTutto, poi syncCrmFromPlatform', async () => {
    requireAdminOrCron.mockResolvedValue(null);
    riconciliaTutto.mockResolvedValue({ proposte: 5, agganciati: 4, errori: 0 });
    syncCrmFromPlatform.mockResolvedValue({ scanned: 10, updated: 10 });
    await GET(req());
    expect(chiamate).toEqual(['riconciliaTutto', 'syncCrmFromPlatform']);
  });

  it('risposta include riconciliazione oltre a scanned/updated', async () => {
    requireAdminOrCron.mockResolvedValue(null);
    riconciliaTutto.mockResolvedValue({ proposte: 5, agganciati: 4, errori: 1 });
    syncCrmFromPlatform.mockResolvedValue({ scanned: 10, updated: 9 });
    const res = await GET(req());
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      riconciliazione: { proposte: 5, agganciati: 4, errori: 1 },
      scanned: 10,
      updated: 9,
    });
  });

  it('logga un riepilogo strutturato a fine job (run troncato → si vede dove si era arrivati)', async () => {
    requireAdminOrCron.mockResolvedValue(null);
    riconciliaTutto.mockResolvedValue({ proposte: 5, agganciati: 4, errori: 1 });
    syncCrmFromPlatform.mockResolvedValue({ scanned: 10, updated: 9 });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await GET(req());
    expect(logSpy).toHaveBeenCalledWith('[crm-sync]', {
      proposte: 5,
      agganciati: 4,
      errori: 1,
      scanned: 10,
      updated: 9,
    });
    logSpy.mockRestore();
  });
});
