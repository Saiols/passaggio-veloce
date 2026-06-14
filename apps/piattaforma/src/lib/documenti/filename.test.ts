import { describe, it, expect } from 'vitest';
import { appendToFilename } from './filename';

describe('appendToFilename', () => {
  it('aggiunge numero pratica e targa prima dell\'estensione', () => {
    expect(appendToFilename('libretto.pdf', 'PV-2026-00042', 'AB123CD')).toBe(
      'libretto - PV-2026-00042 - AB123CD.pdf',
    );
  });

  it('salta le parti vuote/null', () => {
    expect(appendToFilename('libretto.pdf', 'PV-1', null)).toBe('libretto - PV-1.pdf');
    expect(appendToFilename('libretto.pdf', '', undefined)).toBe('libretto.pdf');
    expect(appendToFilename('libretto.pdf')).toBe('libretto.pdf');
  });

  it('gestisce i file senza estensione', () => {
    expect(appendToFilename('scan', 'PV-1', 'AB1')).toBe('scan - PV-1 - AB1');
  });

  it('preserva solo l\'ultima estensione con nomi multi-punto', () => {
    expect(appendToFilename('my.photo.jpg', 'PV-1')).toBe('my.photo - PV-1.jpg');
  });

  it('rimuove i caratteri non ammessi dalle parti', () => {
    expect(appendToFilename('a.jpg', 'PV/1', 'AB:1')).toBe('a - PV1 - AB1.jpg');
  });

  it('fallback "documento" se la base si svuota dopo la sanificazione', () => {
    expect(appendToFilename('///.pdf', 'PV-1')).toBe('documento - PV-1.pdf');
  });
});
