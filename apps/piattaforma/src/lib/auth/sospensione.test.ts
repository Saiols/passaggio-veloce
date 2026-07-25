import { describe, it, expect } from 'vitest';
import { calcolaSospensione, NON_SOSPESO } from './sospensione';

const ATTIVO = {
  userStatus: 'ACTIVE',
  userNote: null,
  companySuspendedAt: null,
  companyNote: null,
} as const;

describe('calcolaSospensione', () => {
  it('utente attivo e azienda attiva → non sospeso', () => {
    expect(calcolaSospensione(ATTIVO)).toEqual(NON_SOSPESO);
  });

  it('sospensione individuale → origine UTENTE, motivo dalla nota utente', () => {
    // Stato prodotto da suspendUserAction: status SUSPENDED + nota sull'utente,
    // Company.suspendedAt resta null.
    expect(
      calcolaSospensione({
        ...ATTIVO,
        userStatus: 'SUSPENDED',
        userNote: 'Uso improprio della piattaforma.',
      }),
    ).toEqual({ sospeso: true, motivo: 'Uso improprio della piattaforma.', origine: 'UTENTE' });
  });

  it('sospensione aziendale → origine AZIENDA, motivo dalla nota azienda', () => {
    // Stato prodotto da suspendCompanyAction: suspendedAt + nota sulla company,
    // e in cascata tutti gli utenti a SUSPENDED. La nota utente resta vuota.
    expect(
      calcolaSospensione({
        ...ATTIVO,
        userStatus: 'SUSPENDED',
        companySuspendedAt: new Date('2026-07-25T10:00:00Z'),
        companyNote: 'Visura non conforme.',
      }),
    ).toEqual({ sospeso: true, motivo: 'Visura non conforme.', origine: 'AZIENDA' });
  });

  it('sospensione individuale preesistente + sospensione aziendale → prevale AZIENDA', () => {
    // La misura aziendale è la più ampia, ed è il suo motivo quello che
    // l'utente ha ricevuto per email (N14).
    expect(
      calcolaSospensione({
        userStatus: 'SUSPENDED',
        userNote: 'Nota individuale precedente.',
        companySuspendedAt: new Date('2026-07-25T10:00:00Z'),
        companyNote: 'Nota aziendale.',
      }),
    ).toEqual({ sospeso: true, motivo: 'Nota aziendale.', origine: 'AZIENDA' });
  });

  it('azienda sospesa senza motivo → sospeso con motivo null, non crasha', () => {
    expect(
      calcolaSospensione({ ...ATTIVO, companySuspendedAt: new Date(), companyNote: null }),
    ).toEqual({ sospeso: true, motivo: null, origine: 'AZIENDA' });
  });

  it('status PENDING_EMAIL_VERIFICATION non è una sospensione', () => {
    // Ha già il suo gate al login: non deve diventare una sola lettura.
    expect(calcolaSospensione({ ...ATTIVO, userStatus: 'PENDING_EMAIL_VERIFICATION' })).toEqual(
      NON_SOSPESO,
    );
  });

  it('campi undefined (utente senza company) → non sospeso', () => {
    expect(
      calcolaSospensione({
        userStatus: undefined,
        userNote: undefined,
        companySuspendedAt: undefined,
        companyNote: undefined,
      }),
    ).toEqual(NON_SOSPESO);
  });
});
