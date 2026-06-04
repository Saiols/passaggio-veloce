import 'server-only';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import type { LibrettoCircolazioneData, OcrExtractInput, OcrProvider, OcrTextResult } from './types';
import { OcrFailedError } from './types';
import { parseLibrettoText } from './libretto-parser';

/** Mappa il `document` di Document AI in OcrTextResult. Puro/testabile. */
export function documentToTextResult(document: {
  text?: string | null;
  pages?: Array<{ layout?: { confidence?: number | null } | null }> | null;
}): OcrTextResult {
  const pages = document.pages ?? [];
  const confs = pages
    .map((p) => p.layout?.confidence)
    .filter((c): c is number => typeof c === 'number');
  const confidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  return { text: document.text ?? '', confidence, pages: pages.length };
}

export class GoogleDocumentAiProvider implements OcrProvider {
  readonly name = 'google_documentai' as const;
  private readonly client: DocumentProcessorServiceClient;
  private readonly processorName: string;

  constructor(opts: {
    projectId: string;
    location: string;
    processorId: string;
    credentialsJson: string;
  }) {
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(opts.credentialsJson);
    } catch {
      throw new OcrFailedError('GOOGLE_DOCUMENTAI_CREDENTIALS_JSON non è un JSON valido');
    }
    this.client = new DocumentProcessorServiceClient({
      credentials,
      apiEndpoint: `${opts.location}-documentai.googleapis.com`,
    });
    this.processorName = `projects/${opts.projectId}/locations/${opts.location}/processors/${opts.processorId}`;
  }

  async extractText(input: OcrExtractInput): Promise<OcrTextResult> {
    try {
      const [result] = await this.client.processDocument({
        name: this.processorName,
        rawDocument: { content: input.buffer.toString('base64'), mimeType: input.mimeType },
      });
      return documentToTextResult(
        (result.document ?? {}) as Parameters<typeof documentToTextResult>[0],
      );
    } catch (e) {
      throw new OcrFailedError(`Document AI: ${(e as Error).message}`);
    }
  }

  async extractLibretto(input: OcrExtractInput): Promise<LibrettoCircolazioneData> {
    const t = await this.extractText(input);
    return parseLibrettoText(t.text, t.confidence);
  }
}
