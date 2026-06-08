export type OcrProviderName = 'mock' | 'mindee' | 'google_documentai';

/** Intestatario del veicolo estratto dal libretto (C.2 = proprietario, C.3 =
 * secondo intestatario/utilizzatore). Persona fisica o giuridica. */
export type OwnerInfo = {
  isPersonaGiuridica: boolean;
  nome?: string;
  cognome?: string;
  cf?: string;
  ragioneSociale?: string;
  piva?: string;
  display: string; // ragione sociale, oppure "COGNOME NOME"
};

export type LibrettoCircolazioneData = {
  targa?: string;
  telaio?: string;
  proprietarioAttuale?: string;
  proprietarioCf?: string; // CF del primo intestatario (se persona)
  proprietari?: string[]; // nomi/display di tutti gli intestatari (C.2 + C.3)
  proprietariInfo?: OwnerInfo[]; // intestatari strutturati (azienda/persona)
  dataImmatricolazione?: string; // ISO yyyy-mm-dd — (B) prima immatricolazione
  dataAcquisto?: string; // ISO yyyy-mm-dd — (I) immatric. cui si riferisce la carta
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

export type OcrTextResult = {
  text: string; // testo completo estratto
  confidence: number; // 0..1
  pages: number;
};

export interface OcrProvider {
  readonly name: OcrProviderName;
  extractLibretto(input: OcrExtractInput): Promise<LibrettoCircolazioneData>;
  extractText(input: OcrExtractInput): Promise<OcrTextResult>;
}

export class OcrFailedError extends Error {
  constructor(reason: string) {
    super(`OCR extraction failed: ${reason}`);
    this.name = 'OcrFailedError';
  }
}
