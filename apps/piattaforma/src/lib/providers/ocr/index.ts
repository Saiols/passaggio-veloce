import 'server-only';
import { env } from '@/env';
import { MockOcrProvider } from './mock';
import { MindeeOcrProvider } from './mindee';
import type { OcrProvider } from './types';

export * from './types';

let instance: OcrProvider | null = null;

export async function getOcr(): Promise<OcrProvider> {
  if (instance) return instance;
  switch (env.OCR_PROVIDER) {
    case 'mock':
      instance = new MockOcrProvider();
      break;
    case 'mindee':
      if (!env.MINDEE_API_KEY || !env.MINDEE_MODEL_ID) {
        throw new Error(
          'MINDEE_API_KEY e MINDEE_MODEL_ID sono obbligatori per OCR_PROVIDER=mindee',
        );
      }
      instance = new MindeeOcrProvider(env.MINDEE_API_KEY, env.MINDEE_MODEL_ID);
      break;
    case 'google_documentai': {
      const { GoogleDocumentAiProvider } = await import('./google-documentai');
      if (
        !env.GOOGLE_DOCUMENTAI_PROJECT_ID ||
        !env.GOOGLE_DOCUMENTAI_PROCESSOR_ID ||
        !env.GOOGLE_DOCUMENTAI_CREDENTIALS_JSON
      ) {
        throw new Error(
          'GOOGLE_DOCUMENTAI_PROJECT_ID, PROCESSOR_ID e CREDENTIALS_JSON sono obbligatori per OCR_PROVIDER=google_documentai',
        );
      }
      instance = new GoogleDocumentAiProvider({
        projectId: env.GOOGLE_DOCUMENTAI_PROJECT_ID,
        location: env.GOOGLE_DOCUMENTAI_LOCATION,
        processorId: env.GOOGLE_DOCUMENTAI_PROCESSOR_ID,
        credentialsJson: env.GOOGLE_DOCUMENTAI_CREDENTIALS_JSON,
      });
      break;
    }
    default:
      throw new Error(`Unknown OCR provider: ${env.OCR_PROVIDER}`);
  }
  return instance;
}
