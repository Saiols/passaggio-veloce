import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

import { GET, POST, maxDuration } from './route';

function req(headers: Record<string, string> = {}) {
  return new Request('https://app.test/api/jobs/crm-sync', { headers }) as unknown as import('next/server').NextRequest;
}

describe('GET/POST /api/jobs/crm-sync', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    requireAdminOrCron.mockReset();
    riconciliaTutto.mockReset();
    syncCrmFromPlatform.mockReset();
    chiamate.length = 0;
    // La route logga davvero su console.log (vedi sotto): senza spiarlo qui,
    // ogni test che invoca l'handler stamperebbe rumore reale su stdout
    // durante la suite.
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
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

  it('POST si comporta come GET (stesso handler)', async () => {
    requireAdminOrCron.mockResolvedValue(null);
    riconciliaTutto.mockResolvedValue({ proposte: 2, agganciati: 2, errori: 0 });
    syncCrmFromPlatform.mockResolvedValue({ scanned: 3, updated: 3 });
    const res = await POST(req());
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      riconciliazione: { proposte: 2, agganciati: 2, errori: 0 },
      scanned: 3,
      updated: 3,
    });
    expect(chiamate).toEqual(['riconciliaTutto', 'syncCrmFromPlatform']);
  });

  it('logga il riepilogo della riconciliazione subito dopo la prima passata, poi il riepilogo completo a fine job', async () => {
    requireAdminOrCron.mockResolvedValue(null);
    riconciliaTutto.mockResolvedValue({ proposte: 5, agganciati: 4, errori: 1 });
    syncCrmFromPlatform.mockResolvedValue({ scanned: 10, updated: 9 });
    await GET(req());
    expect(logSpy.mock.calls[0]).toEqual([
      '[crm-sync] riconciliazione',
      { proposte: 5, agganciati: 4, errori: 1 },
    ]);
    // `riconciliazione` e `result` hanno ENTRAMBI una chiave `arricchiti`
    // (aggancio vs. già agganciati): il log finale li tiene annidati invece
    // di spargerli in un unico spread, altrimenti il secondo sovrascrive il
    // primo in silenzio.
    expect(logSpy.mock.calls[1]).toEqual([
      '[crm-sync] completato',
      { riconciliazione: { proposte: 5, agganciati: 4, errori: 1 }, scanned: 10, updated: 9 },
    ]);
  });

  it('il log finale non fa collidere gli "arricchiti" di riconciliazione e sync', async () => {
    requireAdminOrCron.mockResolvedValue(null);
    riconciliaTutto.mockResolvedValue({ proposte: 800, agganciati: 800, errori: 0, arricchiti: 800 });
    syncCrmFromPlatform.mockResolvedValue({ scanned: 19000, updated: 19000, arricchiti: 0 });
    await GET(req());
    const [, loggato] = logSpy.mock.calls[1]!;
    expect(loggato).toMatchObject({
      riconciliazione: expect.objectContaining({ arricchiti: 800 }),
      arricchiti: 0,
    });
  });

  it('il log della prima passata sopravvive anche se syncCrmFromPlatform fallisce (run troncato)', async () => {
    requireAdminOrCron.mockResolvedValue(null);
    riconciliaTutto.mockResolvedValue({ proposte: 5, agganciati: 4, errori: 0 });
    syncCrmFromPlatform.mockRejectedValue(new Error('timeout'));

    await expect(GET(req())).rejects.toThrow('timeout');

    expect(logSpy).toHaveBeenCalledWith('[crm-sync] riconciliazione', {
      proposte: 5,
      agganciati: 4,
      errori: 0,
    });
    // Il log finale presuppone che syncCrmFromPlatform sia tornato: se il
    // job è troncato lì, non deve essere mai partito.
    expect(logSpy).not.toHaveBeenCalledWith(
      '[crm-sync] completato',
      expect.anything(),
    );
  });

  it('maxDuration resta ampio: decisione operativa (il primo run dopo il deploy smaltisce tutto il pregresso), non un dettaglio da poter abbassare per distrazione', () => {
    expect(maxDuration).toBeGreaterThanOrEqual(300);
  });
});
