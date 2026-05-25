import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MindeeOcrProvider } from './mindee';
import { OcrFailedError } from './types';

const API_KEY = 'test-key';
const ENDPOINT = 'https://api.mindee.net/v1/products/u/libretto/v1/predict';

describe('MindeeOcrProvider', () => {
  const provider = new MindeeOcrProvider(API_KEY, ENDPOINT);

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockMindeeResponse(prediction: Record<string, unknown>, status = 200) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          document: { inference: { prediction } },
        }),
        { status, headers: { 'content-type': 'application/json' } },
      ),
    );
  }

  it('exposes name = "mindee"', () => {
    expect(provider.name).toBe('mindee');
  });

  it('maps a full Mindee response to LibrettoCircolazioneData with normalized fields', async () => {
    mockMindeeResponse({
      targa: { value: 'fa 123 gh', confidence: 0.95 },
      telaio: { value: 'zfa19500005123456', confidence: 0.92 },
      proprietario_attuale: { value: 'Mario Rossi', confidence: 0.9 },
      data_immatricolazione: { value: '2012-06-15', confidence: 0.88 },
      flag_comodato_uso: { value: 'no', confidence: 0.99 },
    });

    const result = await provider.extractLibretto({
      buffer: Buffer.from('fake pdf'),
      mimeType: 'application/pdf',
      originalFilename: 'libretto.pdf',
    });

    expect(result.targa).toBe('FA123GH');
    expect(result.telaio).toBe('ZFA19500005123456');
    expect(result.proprietarioAttuale).toBe('Mario Rossi');
    expect(result.dataImmatricolazione).toBe('2012-06-15');
    expect(result.preImm2015).toBe(true);
    expect(result.flagComodatoDuso).toBe(false);
    expect(result.confidenceScore).toBeCloseTo((0.95 + 0.92 + 0.9 + 0.88) / 4, 3);
  });

  it('flags comodato d\'uso when Mindee returns "sì"', async () => {
    mockMindeeResponse({
      targa: { value: 'AB123CD', confidence: 0.9 },
      flag_comodato_uso: { value: 'sì', confidence: 0.95 },
    });

    const result = await provider.extractLibretto({
      buffer: Buffer.from('x'),
      mimeType: 'image/jpeg',
    });

    expect(result.flagComodatoDuso).toBe(true);
  });

  it('handles missing data_immatricolazione gracefully', async () => {
    mockMindeeResponse({
      targa: { value: 'CD456EF', confidence: 0.85 },
      telaio: { value: 'ABCDEFGH123456789', confidence: 0.8 },
    });

    const result = await provider.extractLibretto({
      buffer: Buffer.from('x'),
      mimeType: 'image/png',
    });

    expect(result.dataImmatricolazione).toBeUndefined();
    expect(result.preImm2015).toBe(false);
  });

  it('marks post-2015 vehicles correctly', async () => {
    mockMindeeResponse({
      data_immatricolazione: { value: '2020-03-01', confidence: 0.9 },
    });

    const result = await provider.extractLibretto({
      buffer: Buffer.from('x'),
      mimeType: 'application/pdf',
    });

    expect(result.preImm2015).toBe(false);
  });

  it('returns confidenceScore 0 when no fields have confidence', async () => {
    mockMindeeResponse({});

    const result = await provider.extractLibretto({
      buffer: Buffer.from('x'),
      mimeType: 'application/pdf',
    });

    expect(result.confidenceScore).toBe(0);
  });

  it('throws OcrFailedError on HTTP 401', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    );

    await expect(
      provider.extractLibretto({
        buffer: Buffer.from('x'),
        mimeType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(OcrFailedError);
  });

  it('throws OcrFailedError on HTTP 500', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('Server error', { status: 500 }),
    );

    await expect(
      provider.extractLibretto({
        buffer: Buffer.from('x'),
        mimeType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(OcrFailedError);
  });

  it('sends the file as multipart form-data with Authorization header', async () => {
    mockMindeeResponse({ targa: { value: 'XX000XX', confidence: 0.9 } });

    await provider.extractLibretto({
      buffer: Buffer.from('hello'),
      mimeType: 'application/pdf',
      originalFilename: 'mybook.pdf',
    });

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: `Token ${API_KEY}` });
    expect(init.body).toBeInstanceOf(FormData);
  });
});
