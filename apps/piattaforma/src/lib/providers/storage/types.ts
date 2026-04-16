import type { Readable } from 'node:stream';

export type StorageProviderName = 'local' | 's3';

export type StoragePutInput = {
  /** Scope path (e.g. "pratica/<uuid>" or "company/<uuid>"). Sanitized internally. */
  scope: string;
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
};

export type StoragePutResult = {
  storageKey: string;
  storageProvider: StorageProviderName;
  sizeBytes: number;
  mimeType: string;
  originalFilename: string;
};

export type StorageGetResult = {
  stream: Readable;
  sizeBytes: number;
  mimeType: string;
  originalFilename?: string;
};

export interface StorageProvider {
  readonly name: StorageProviderName;
  put(input: StoragePutInput): Promise<StoragePutResult>;
  get(storageKey: string): Promise<StorageGetResult>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
}

export class StorageNotFoundError extends Error {
  constructor(storageKey: string) {
    super(`Storage key not found: ${storageKey}`);
    this.name = 'StorageNotFoundError';
  }
}
