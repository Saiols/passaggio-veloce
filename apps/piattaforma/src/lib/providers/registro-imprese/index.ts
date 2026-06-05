import 'server-only';
import { env } from '@/env';
import { MockRegistroImpreseProvider } from './mock';
import { NoopRegistroImpreseProvider } from './noop';
import type { RegistroImpreseProvider } from './types';

export * from './types';

let instance: RegistroImpreseProvider | null = null;

export function getRegistroImprese(): RegistroImpreseProvider {
  if (instance) return instance;
  switch (env.REGISTRO_IMPRESE_PROVIDER) {
    case 'mock':
      instance = new MockRegistroImpreseProvider();
      break;
    case 'noop':
      instance = new NoopRegistroImpreseProvider();
      break;
    case 'openapi':
      throw new Error(
        'RegistroImprese provider "openapi" non ancora implementato (in attesa account esterno)',
      );
    case 'infocamere':
      throw new Error(
        'RegistroImprese provider "infocamere" non ancora implementato (in attesa account esterno)',
      );
    default:
      throw new Error(
        `Unknown RegistroImprese provider: ${env.REGISTRO_IMPRESE_PROVIDER}`,
      );
  }
  return instance;
}
