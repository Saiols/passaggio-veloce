import { describe, expect, it, vi } from 'vitest';
import { mapResponseToLibretto, MindeeOcrProvider } from './mindee';
import { OcrFailedError } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FieldLike = { stringValue?: string | null; confidence?: string };

function makeFields(
  entries: Record<string, { stringValue?: string | null; confidence?: string }>,
): Map<string, FieldLike> {
  return new Map(Object.entries(entries));
}

// ---------------------------------------------------------------------------
// Unit tests for the pure mapping function (no SDK mocking needed)
// ---------------------------------------------------------------------------

describe('mapResponseToLibretto', () => {
  it('maps all ICAO EU fields to LibrettoCircolazioneData with normalization', () => {
    const fields = makeFields({
      a: { stringValue: 'fa 123 gh', confidence: 'High' },
      e: { stringValue: 'zfa19500005123456', confidence: 'Certain' },
      c1: { stringValue: 'Mario Rossi', confidence: 'High' },
      b: { stringValue: '2012-06-15', confidence: 'Medium' },
      x1: { stringValue: 'LUNGHEZZA 3,970 M - nessuna clausola' },
    });

    const result = mapResponseToLibretto(fields);

    expect(result.targa).toBe('FA123GH');
    expect(result.telaio).toBe('ZFA19500005123456');
    expect(result.proprietarioAttuale).toBe('Mario Rossi');
    expect(result.dataImmatricolazione).toBe('2012-06-15');
    expect(result.preImm2015).toBe(true);
    expect(result.flagComodatoDuso).toBe(false);
    // confidence: High=0.75, Certain=1.0, High=0.75, Medium=0.5 → avg = 3.0/4 = 0.75
    expect(result.confidenceScore).toBeCloseTo((0.75 + 1.0 + 0.75 + 0.5) / 4, 5);
  });

  it('preImm2015 = true for date 2014-12-31', () => {
    const fields = makeFields({ b: { stringValue: '2014-12-31' } });
    expect(mapResponseToLibretto(fields).preImm2015).toBe(true);
  });

  it('preImm2015 = false for date 2015-01-01', () => {
    const fields = makeFields({ b: { stringValue: '2015-01-01' } });
    expect(mapResponseToLibretto(fields).preImm2015).toBe(false);
  });

  it('flagComodatoDuso = true when x1 contains "COMODATO D\'USO" (uppercase)', () => {
    const fields = makeFields({ x1: { stringValue: "LUNGHEZZA 3,970 M - COMODATO D'USO IN ESSERE" } });
    expect(mapResponseToLibretto(fields).flagComodatoDuso).toBe(true);
  });

  it('flagComodatoDuso = true when x1 contains "comodato d\'uso" (lowercase)', () => {
    const fields = makeFields({ x1: { stringValue: "comodato d'uso" } });
    expect(mapResponseToLibretto(fields).flagComodatoDuso).toBe(true);
  });

  it('flagComodatoDuso = false when x1 is missing', () => {
    const fields = makeFields({ a: { stringValue: 'AB123CD' } });
    expect(mapResponseToLibretto(fields).flagComodatoDuso).toBe(false);
  });

  it('flagComodatoDuso = false when x1 does not contain "comodato"', () => {
    const fields = makeFields({ x1: { stringValue: 'LUNGHEZZA 3,970 M - FINANZIAMENTO' } });
    expect(mapResponseToLibretto(fields).flagComodatoDuso).toBe(false);
  });

  it('confidenceScore = 0.9 (fallback) when all field confidences are null/undefined', () => {
    const fields = makeFields({
      a: { stringValue: 'AB123CD' },
      e: { stringValue: 'VIN12345678901234' },
      c1: { stringValue: 'Mario Rossi' },
      b: { stringValue: '2020-01-01' },
    });
    // No confidence on any field → fallback 0.9
    expect(mapResponseToLibretto(fields).confidenceScore).toBe(0.9);
  });

  it('confidenceScore is computed average when some confidences are present', () => {
    const fields = makeFields({
      a: { stringValue: 'AB123CD', confidence: 'Certain' }, // 1.0
      e: { stringValue: 'VIN12345678901234', confidence: 'Low' }, // 0.25
      // c1 and b missing confidence → filtered out
    });
    expect(mapResponseToLibretto(fields).confidenceScore).toBeCloseTo((1.0 + 0.25) / 2, 5);
  });

  it('handles missing b field gracefully (undefined dataImmatricolazione, preImm2015 false)', () => {
    const fields = makeFields({ a: { stringValue: 'AB123CD', confidence: 'High' } });
    const result = mapResponseToLibretto(fields);
    expect(result.dataImmatricolazione).toBeUndefined();
    expect(result.preImm2015).toBe(false);
  });

  it('targa and telaio are undefined when fields a and e are absent', () => {
    const fields = makeFields({ c1: { stringValue: 'Mario Rossi' } });
    const result = mapResponseToLibretto(fields);
    expect(result.targa).toBeUndefined();
    expect(result.telaio).toBeUndefined();
  });

  it('strips all whitespace from targa and telaio and uppercases them', () => {
    const fields = makeFields({
      a: { stringValue: '  ab  12  cd  ' },
      e: { stringValue: ' vin 1234 5678 9012 34 ' },
    });
    expect(mapResponseToLibretto(fields).targa).toBe('AB12CD');
    expect(mapResponseToLibretto(fields).telaio).toBe('VIN123456789012 34'.replace(/\s+/g, ''));
  });
});

// ---------------------------------------------------------------------------
// Integration-level test for MindeeOcrProvider.extractLibretto (SDK mocked)
// ---------------------------------------------------------------------------

// Shared mock function that tests can configure per-call
const mockEnqueueAndGetResult = vi.fn();

vi.mock('mindee', () => {
  // Use a class so `new mindee.Client(...)` works as a constructor
  class MockClient {
    enqueueAndGetResult = mockEnqueueAndGetResult;
  }
  // Use a class so `new mindee.BufferInput(...)` works as a constructor
  class MockBufferInput {}

  return {
    Client: MockClient,
    BufferInput: MockBufferInput,
    product: { Extraction: 'Extraction' },
  };
});

describe('MindeeOcrProvider.extractLibretto', () => {
  const provider = new MindeeOcrProvider('test-api-key', 'test-model-id');

  it('exposes name = "mindee"', () => {
    expect(provider.name).toBe('mindee');
  });

  it('maps SDK response fields to LibrettoCircolazioneData', async () => {
    mockEnqueueAndGetResult.mockResolvedValueOnce({
      inference: {
        result: {
          fields: makeFields({
            a: { stringValue: 'xx 123 yy', confidence: 'Certain' },
            e: { stringValue: 'vin00000000000001', confidence: 'High' },
            c1: { stringValue: 'Giulia Bianchi', confidence: 'High' },
            b: { stringValue: '2010-03-22', confidence: 'Medium' },
          }),
        },
      },
    });

    const result = await provider.extractLibretto({
      buffer: Buffer.from('pdf-bytes'),
      mimeType: 'application/pdf',
      originalFilename: 'libretto.pdf',
    });

    expect(result.targa).toBe('XX123YY');
    expect(result.telaio).toBe('VIN00000000000001');
    expect(result.proprietarioAttuale).toBe('Giulia Bianchi');
    expect(result.preImm2015).toBe(true);
  });

  it('throws OcrFailedError when SDK throws', async () => {
    mockEnqueueAndGetResult.mockRejectedValueOnce(new Error('Network timeout'));

    await expect(
      provider.extractLibretto({
        buffer: Buffer.from('x'),
        mimeType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(OcrFailedError);
  });
});
