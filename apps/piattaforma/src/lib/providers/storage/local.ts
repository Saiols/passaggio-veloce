import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  StorageNotFoundError,
  type StorageGetResult,
  type StoragePutInput,
  type StoragePutResult,
  type StorageProvider,
} from './types';

const SAFE_SCOPE = /^[a-z0-9_\-/]+$/i;

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-120);
}

function assertSafeScope(scope: string): void {
  if (!SAFE_SCOPE.test(scope) || scope.includes('..')) {
    throw new Error(`Invalid scope: ${scope}`);
  }
}

export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local' as const;

  constructor(private readonly baseDir: string) {}

  private fullPath(storageKey: string): string {
    if (storageKey.includes('..') || path.isAbsolute(storageKey)) {
      throw new Error(`Invalid storage key: ${storageKey}`);
    }
    return path.join(this.baseDir, storageKey);
  }

  async put(input: StoragePutInput): Promise<StoragePutResult> {
    assertSafeScope(input.scope);
    const filename = `${randomUUID()}-${sanitizeFilename(input.originalFilename)}`;
    const storageKey = path.posix.join(input.scope, filename);
    const dest = this.fullPath(storageKey);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, input.buffer);
    return {
      storageKey,
      storageProvider: this.name,
      sizeBytes: input.buffer.length,
      mimeType: input.mimeType,
      originalFilename: input.originalFilename,
    };
  }

  async get(storageKey: string): Promise<StorageGetResult> {
    const full = this.fullPath(storageKey);
    try {
      const st = await stat(full);
      if (!st.isFile()) throw new StorageNotFoundError(storageKey);
      return {
        stream: createReadStream(full),
        sizeBytes: st.size,
        mimeType: 'application/octet-stream',
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StorageNotFoundError(storageKey);
      }
      throw err;
    }
  }

  async delete(storageKey: string): Promise<void> {
    const full = this.fullPath(storageKey);
    await rm(full, { force: true });
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await access(this.fullPath(storageKey));
      return true;
    } catch {
      return false;
    }
  }
}
