import 'server-only';
import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';
import { put, head, del } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  StorageNotFoundError,
  type StorageGetResult,
  type StoragePutInput,
  type StoragePutResult,
  type StorageProvider,
} from './types';

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').slice(-120);
}

const SAFE_SCOPE = /^[a-z0-9_\-/]+$/i;

function assertSafeScope(scope: string): void {
  if (!SAFE_SCOPE.test(scope) || scope.includes('..')) {
    throw new Error(`Invalid scope: ${scope}`);
  }
}

export class VercelBlobStorageProvider implements StorageProvider {
  readonly name = 'vercel-blob' as const;

  constructor(private readonly token: string) {}

  async put(input: StoragePutInput): Promise<StoragePutResult> {
    assertSafeScope(input.scope);
    const filename = `${randomUUID()}-${sanitizeFilename(input.originalFilename)}`;
    const storageKey = path.posix.join(input.scope, filename);
    await put(storageKey, input.buffer, {
      access: 'public',
      contentType: input.mimeType,
      token: this.token,
      addRandomSuffix: false,
    });
    return {
      storageKey,
      storageProvider: this.name,
      sizeBytes: input.buffer.length,
      mimeType: input.mimeType,
      originalFilename: input.originalFilename,
    };
  }

  async get(storageKey: string): Promise<StorageGetResult> {
    let meta;
    try {
      meta = await head(storageKey, { token: this.token });
    } catch {
      throw new StorageNotFoundError(storageKey);
    }
    const response = await fetch(meta.url);
    if (!response.ok || !response.body) {
      throw new StorageNotFoundError(storageKey);
    }
    return {
      stream: Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
      sizeBytes: meta.size,
      mimeType: meta.contentType ?? 'application/octet-stream',
    };
  }

  async delete(storageKey: string): Promise<void> {
    await del(storageKey, { token: this.token });
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await head(storageKey, { token: this.token });
      return true;
    } catch {
      return false;
    }
  }
}
