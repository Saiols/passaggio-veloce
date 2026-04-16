export type OcrProviderName = 'mock' | 'google_documentai';

export type LibrettoCircolazioneData = {
  targa?: string;
  telaio?: string;
  proprietarioAttuale?: string;
  dataImmatricolazione?: string; // ISO yyyy-mm-dd
  preImm2015: boolean;
  flagComodatoDuso: boolean;
  confidenceScore: number; // 0..1
  rawText?: string;
};

export type OcrExtractInput = {
  buffer: Buffer;
  mimeType: string;
  originalFilename?: string;
};

export interface OcrProvider {
  readonly name: OcrProviderName;
  extractLibretto(input: OcrExtractInput): Promise<LibrettoCircolazioneData>;
}

export class OcrFailedError extends Error {
  constructor(reason: string) {
    super(`OCR extraction failed: ${reason}`);
    this.name = 'OcrFailedError';
  }
}
