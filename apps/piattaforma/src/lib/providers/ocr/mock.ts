import { createHash } from 'node:crypto';
import type {
  LibrettoCircolazioneData,
  OcrExtractInput,
  OcrProvider,
  OcrTextResult,
} from './types';

const SAMPLE_TARGHE = ['FA123GH', 'EJ456LM', 'GT789NO', 'FB234PQ', 'EZ567RS'];
const SAMPLE_TELAI = [
  'ZFA19500005123456',
  'WAUZZZ8V3JA098765',
  'WVWZZZ1KZBW234567',
  'JMBSNC74A4U056789',
  'VF1RFD00X57345678',
];
const SAMPLE_NAMES = [
  'Mario Rossi',
  'Giuseppe Bianchi',
  'Anna Verdi',
  'Francesca Neri',
  'Luca Ferrari',
];

export class MockOcrProvider implements OcrProvider {
  readonly name = 'mock' as const;

  async extractLibretto(input: OcrExtractInput): Promise<LibrettoCircolazioneData> {
    const hash = createHash('sha256').update(input.buffer).digest();
    const pick = (arr: readonly string[], offset: number): string =>
      arr[hash[offset]! % arr.length]!;

    const yearOffset = hash[4]! % 20; // 0..19
    const year = 2008 + yearOffset;   // 2008..2027
    const month = (hash[5]! % 12) + 1;
    const day = (hash[6]! % 28) + 1;
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    await new Promise((resolve) => setTimeout(resolve, 120)); // simulate latency

    return {
      targa: pick(SAMPLE_TARGHE, 0),
      telaio: pick(SAMPLE_TELAI, 1),
      proprietarioAttuale: pick(SAMPLE_NAMES, 2),
      dataImmatricolazione: iso,
      preImm2015: year < 2015,
      flagComodatoDuso: hash[7]! % 10 === 0, // ~10% dei casi
      confidenceScore: 0.82 + (hash[8]! % 15) / 100, // 0.82..0.96
      rawText: `[mock ocr ${input.mimeType} ${input.buffer.length}B]`,
    };
  }

  async extractText(input: OcrExtractInput): Promise<OcrTextResult> {
    const hash = createHash('sha256').update(input.buffer).digest('hex');
    return {
      text: `MOCK OCR TEXT\nhash=${hash}\nbytes=${input.buffer.length}`,
      confidence: 0.9,
      pages: 1,
    };
  }
}
