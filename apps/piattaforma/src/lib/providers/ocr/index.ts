import 'server-only';
import { env } from '@/env';
import { MockOcrProvider } from './mock';
import { MindeeOcrProvider } from './mindee';
import type { OcrProvider } from './types';

export * from './types';

let instance: OcrProvider | null = null;

export function getOcr(): OcrProvider {
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
    case 'google_documentai':
      throw new Error('Google Document AI OCR provider not yet implemented (Fase 2)');
    default:
      throw new Error(`Unknown OCR provider: ${env.OCR_PROVIDER}`);
  }
  return instance;
}
