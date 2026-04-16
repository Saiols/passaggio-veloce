import 'server-only';
import path from 'node:path';
import { env } from '@/env';
import { ConsoleEmailProvider } from './console';
import type { EmailProvider } from './types';

export * from './types';

let instance: EmailProvider | null = null;

export function getEmail(): EmailProvider {
  if (instance) return instance;
  switch (env.EMAIL_PROVIDER) {
    case 'console': {
      const dumpDir = env.EMAIL_CONSOLE_DIR
        ? path.resolve(process.cwd(), env.EMAIL_CONSOLE_DIR)
        : null;
      instance = new ConsoleEmailProvider(dumpDir);
      break;
    }
    case 'resend':
      throw new Error('Resend email provider not yet implemented');
    default:
      throw new Error(`Unknown email provider: ${env.EMAIL_PROVIDER}`);
  }
  return instance;
}
