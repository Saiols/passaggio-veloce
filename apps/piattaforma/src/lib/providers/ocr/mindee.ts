import 'server-only';
import * as mindee from 'mindee';
import { Agent } from 'undici';
import {
  type LibrettoCircolazioneData,
  type OcrExtractInput,
  type OcrProvider,
  OcrFailedError,
} from './types';

/**
 * Dispatcher undici personalizzato per evitare "other side closed" durante il
 * polling lungo del Mindee SDK V2. Default undici tiene aperta la connessione
 * TCP via keep-alive; dopo ~30s di vita la connessione viene chiusa dal
 * proxy/firewall mentre il SDK la riusa per il polling successivo, generando
 * SocketError "other side closed". Forziamo keep-alive cortissimo così ogni
 * polling apre una nuova connessione fresca.
 */
const NO_KEEPALIVE_DISPATCHER = new Agent({
  keepAliveTimeout: 1_000,
  keepAliveMaxTimeout: 2_000,
  connectTimeout: 10_000,
});

/**
 * Mapping ICAO EU field codes from the Mindee pre-trained European Vehicle Registration model
 * to LibrettoCircolazioneData fields:
 *   a  = targa (registration number)
 *   e  = telaio (VIN)
 *   c1 = proprietario (owner name)
 *   b  = data prima immatricolazione (ISO yyyy-mm-dd)
 *   x1 = note libere (parsed for "COMODATO" substring to detect comodato d'uso)
 *   i  = data immatricolazione corrente (NOT used)
 *   document_number = numero libretto (NOT used — it's not the targa)
 */

// FieldConfidence is an enum: Certain | High | Medium | Low
// We map it to a 0..1 scale for our confidenceScore.
const CONFIDENCE_MAP: Record<string, number> = {
  Certain: 1.0,
  High: 0.75,
  Medium: 0.5,
  Low: 0.25,
};

/** Shape returned by response.inference.result.fields (a Map of SimpleField/ObjectField/ListField) */
type FieldLike = {
  stringValue?: string | null;
  confidence?: { toString(): string } | string | undefined;
};

export class MindeeOcrProvider implements OcrProvider {
  readonly name = 'mindee' as const;

  private readonly client: mindee.Client;

  constructor(
    private readonly apiKey: string,
    private readonly modelId: string,
  ) {
    this.client = new mindee.Client({
      apiKey,
      dispatcher: NO_KEEPALIVE_DISPATCHER,
    });
  }

  async extractLibretto(input: OcrExtractInput): Promise<LibrettoCircolazioneData> {
    const bufferInput = new mindee.BufferInput({
      buffer: input.buffer,
      filename: input.originalFilename ?? 'libretto.pdf',
    });

    try {
      // Polling stretto per stare sotto i 60s di Vercel function maxDuration.
      // Default SDK = 2s initial + 1.5s × 80 = 122s. Riduciamo a ~52s max.
      const pollingOptions = {
        initialDelaySec: 2,
        delaySec: 2,
        maxRetries: 25,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await this.client.enqueueAndGetResult(
        mindee.product.Extraction,
        bufferInput,
        {
          modelId: this.modelId,
          confidence: true,
          rawText: false,
          polygon: false,
          rag: false,
        },
        pollingOptions,
      );
      const fields: Map<string, FieldLike> = response.inference.result.fields;
      return mapResponseToLibretto(fields);
    } catch (err) {
      if (err instanceof OcrFailedError) throw err;
      throw new OcrFailedError(
        `Mindee SDK error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/**
 * Pure mapping function — exported for unit-testing without SDK mocking.
 * Accepts any Map<string, { stringValue?, confidence? }> so tests can pass plain objects.
 */
export function mapResponseToLibretto(
  fields: Map<string, FieldLike>,
): LibrettoCircolazioneData {
  const getStr = (code: string): string | undefined => {
    const f = fields.get(code);
    if (!f) return undefined;
    const v = f.stringValue;
    return v != null ? v : undefined;
  };

  const targa = getStr('a')?.toUpperCase().replace(/\s+/g, '');
  const telaio = getStr('e')?.toUpperCase().replace(/\s+/g, '');
  const proprietarioAttuale = getStr('c1');
  const dataIso = getStr('b'); // ISO yyyy-mm-dd from Mindee

  const year = dataIso ? parseInt(dataIso.slice(0, 4), 10) : null;
  const preImm2015 = year !== null && !Number.isNaN(year) && year < 2015;

  const x1Notes = getStr('x1') ?? '';
  const flagComodatoDuso = /comodato/i.test(x1Notes);

  const confidenceScore = computeConfidence(fields, ['a', 'e', 'c1', 'b']);

  return {
    targa,
    telaio,
    proprietarioAttuale,
    dataImmatricolazione: dataIso,
    preImm2015,
    flagComodatoDuso,
    confidenceScore,
    rawText: undefined,
  };
}

/**
 * Converts a FieldConfidence enum (or its string representation) to 0..1.
 * Returns null when confidence is absent/unknown.
 */
function confidenceToNumber(c: FieldLike['confidence']): number | null {
  if (c === undefined || c === null) return null;
  const key = typeof c === 'string' ? c : c.toString();
  return CONFIDENCE_MAP[key] ?? null;
}

function computeConfidence(fields: Map<string, FieldLike>, codes: string[]): number {
  const scores = codes
    .map((code) => confidenceToNumber(fields.get(code)?.confidence))
    .filter((n): n is number => n !== null);

  if (scores.length === 0) return 0.9; // fallback when Mindee returns null even with confidence:true
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}
