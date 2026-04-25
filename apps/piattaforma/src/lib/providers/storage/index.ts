import 'server-only';
import path from 'node:path';
import { env } from '@/env';
import { LocalStorageProvider } from './local';
import { VercelBlobStorageProvider } from './vercel-blob';
import type { StorageProvider } from './types';

export * from './types';

let instance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (instance) return instance;
  switch (env.STORAGE_PROVIDER) {
    case 'local': {
      const baseDir = path.resolve(process.cwd(), env.STORAGE_LOCAL_DIR);
      instance = new LocalStorageProvider(baseDir);
      break;
    }
    case 'vercel-blob': {
      if (!env.BLOB_READ_WRITE_TOKEN) {
        throw new Error('BLOB_READ_WRITE_TOKEN required for vercel-blob storage');
      }
      instance = new VercelBlobStorageProvider(env.BLOB_READ_WRITE_TOKEN);
      break;
    }
    case 's3':
      throw new Error('S3 storage provider not yet implemented');
    default:
      throw new Error(`Unknown storage provider: ${env.STORAGE_PROVIDER}`);
  }
  return instance;
}
