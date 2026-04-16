import 'server-only';
import { env } from '@/env';
import { MockOcrProvider } from './mock';
import type { OcrProvider } from './types';

export * from './types';

let instance: OcrProvider | null = null;

export function getOcr(): OcrProvider {
  if (instance) return instance;
  switch (env.OCR_PROVIDER) {
    case 'mock':
      instance = new MockOcrProvider();
      break;
    case 'google_documentai':
      throw new Error('Google Document AI OCR provider not yet implemented');
    default:
      throw new Error(`Unknown OCR provider: ${env.OCR_PROVIDER}`);
  }
  return instance;
}
