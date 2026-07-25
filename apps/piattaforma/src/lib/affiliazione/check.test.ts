import { describe, it, expect, vi } from 'vitest';
import { flagLabel } from './check-util';
import { detectCollusion } from './check';

describe('flagLabel', () => {
  it('returns human-friendly label for SAME_IBAN', () => {
    expect(flagLabel('SAME_IBAN')).toBe('Stesso IBAN');
  });
  it('returns human-friendly label for SAME_IP_SIGNUP', () => {
    expect(flagLabel('SAME_IP_SIGNUP')).toBe('Stesso IP di signup');
  });
  it('returns human-friendly label for SAME_EMAIL_DOMAIN', () => {
    expect(flagLabel('SAME_EMAIL_DOMAIN')).toBe('Stesso dominio email aziendale');
  });
  it('returns human-friendly label for SAME_ADMIN', () => {
    expect(flagLabel('SAME_ADMIN')).toBe(
      'Stesso amministratore (codice fiscale) tra le due aziende',
    );
  });
});

/**
 * SAME_ADMIN (2026-07-25): dopo l'unicità globale dell'email, la stessa
 * persona non può più comparire due volte con la stessa email — quindi il
 * match anti-collusione è stato ribasato sul codice fiscale degli
 * ADMIN_AZIENDA, che identifica la persona fisica indipendentemente
 * dall'account. Qui testiamo SOLO questo flag: le company usano IBAN, IP di
 * signup e dominio email diversi (e pubblici) apposta, per non far scattare
 * gli altri flag e tenere l'assert pulito.
 */
describe('detectCollusion — SAME_ADMIN', () => {
  function fakeCompany(id: string, email: string) {
    return {
      id,
      iban: `IT00X0000000000000000000${id}`,
      signupIp: `10.0.0.${id}`,
      email,
      sedi: [] as { iban: string | null }[],
    };
  }

  function makeTx(opts: {
    referente: ReturnType<typeof fakeCompany>;
    referral: ReturnType<typeof fakeCompany>;
    refAdmins: { codiceFiscale: string | null }[];
    reflAdmins: { codiceFiscale: string | null }[];
  }) {
    return {
      company: {
        findUnique: vi.fn(({ where }: { where: { id: string } }) => {
          if (where.id === opts.referente.id) return Promise.resolve(opts.referente);
          if (where.id === opts.referral.id) return Promise.resolve(opts.referral);
          return Promise.resolve(null);
        }),
      },
      user: {
        findMany: vi.fn(({ where }: { where: { companyId: string } }) => {
          if (where.companyId === opts.referente.id) return Promise.resolve(opts.refAdmins);
          if (where.companyId === opts.referral.id) return Promise.resolve(opts.reflAdmins);
          return Promise.resolve([]);
        }),
      },
    } as unknown as Parameters<typeof detectCollusion>[0];
  }

  it('stesso codice fiscale (case diverso incluso) tra gli ADMIN_AZIENDA delle due company → SAME_ADMIN', async () => {
    const referente = fakeCompany('1', 'a@gmail.com');
    const referral = fakeCompany('2', 'b@gmail.com');
    const tx = makeTx({
      referente,
      referral,
      refAdmins: [{ codiceFiscale: 'RSSMRA80A01H501U' }],
      reflAdmins: [{ codiceFiscale: 'rssmra80a01h501u' }],
    });

    const flags = await detectCollusion(tx, referente.id, referral.id);

    expect(flags).toContain('SAME_ADMIN');
  });

  it('codici fiscali diversi → nessun flag SAME_ADMIN', async () => {
    const referente = fakeCompany('1', 'a@gmail.com');
    const referral = fakeCompany('2', 'b@gmail.com');
    const tx = makeTx({
      referente,
      referral,
      refAdmins: [{ codiceFiscale: 'RSSMRA80A01H501U' }],
      reflAdmins: [{ codiceFiscale: 'VRDLGU75B02F205X' }],
    });

    const flags = await detectCollusion(tx, referente.id, referral.id);

    expect(flags).not.toContain('SAME_ADMIN');
  });

  it('entrambi gli ADMIN_AZIENDA senza codice fiscale → NIENTE flag (null non deve combaciare con null)', async () => {
    const referente = fakeCompany('1', 'a@gmail.com');
    const referral = fakeCompany('2', 'b@gmail.com');
    const tx = makeTx({
      referente,
      referral,
      refAdmins: [{ codiceFiscale: null }],
      reflAdmins: [{ codiceFiscale: null }],
    });

    const flags = await detectCollusion(tx, referente.id, referral.id);

    expect(flags).not.toContain('SAME_ADMIN');
  });
});
