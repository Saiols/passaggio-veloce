import { describe, it, expect } from 'vitest';
import { uploadRequiresAuth, REGISTRATION_SCOPE } from './upload-policy';

describe('uploadRequiresAuth', () => {
  it('NON richiede auth per lo scope di registrazione (upload pre-account)', () => {
    expect(uploadRequiresAuth('registrazione/abc-123-doc.pdf')).toBe(false);
    expect(uploadRequiresAuth(`${REGISTRATION_SCOPE}x.jpg`)).toBe(false);
  });

  it('richiede auth per gli allegati pratica', () => {
    expect(uploadRequiresAuth('pratiche-staging/uuid-file.pdf')).toBe(true);
  });

  it('richiede auth per pathname vuoto o sconosciuto', () => {
    expect(uploadRequiresAuth('')).toBe(true);
    expect(uploadRequiresAuth('altro/file.png')).toBe(true);
  });

  it('non si fa ingannare da prefissi simili o annidati', () => {
    // "registrazioneX/" non è lo scope esatto
    expect(uploadRequiresAuth('registrazioneX/file.pdf')).toBe(true);
    // lo scope deve essere all'inizio, non in mezzo
    expect(uploadRequiresAuth('pratiche/registrazione/file.pdf')).toBe(true);
  });
});
