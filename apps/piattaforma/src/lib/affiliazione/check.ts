import 'server-only';
import { Prisma } from '@pv/db';
import { type CollusionFlag, flagLabel as _flagLabel } from './check-util';

/**
 * Detector anti-collusione (AF-AC, FASE 13.6).
 *
 * Regole applicate al momento dell'accredit della commissione: se almeno
 * un flag è triggered, la commissione viene creata con stato
 * DA_REVISIONARE invece di ACCREDITATA, e il wallet NON viene popolato
 * finché un admin non sblocca.
 *
 * Le regole sono tutte indizi, non automatismi: la decisione finale spetta
 * all'admin. False positivi sono accettabili (review umana decide).
 */

export type { CollusionFlag };
export const flagLabel = _flagLabel;

/** Domini email "pubblici": uno scambio di mail su gmail/libero NON è un flag. */
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'libero.it',
  'yahoo.it',
  'yahoo.com',
  'hotmail.com',
  'hotmail.it',
  'outlook.com',
  'outlook.it',
  'live.it',
  'live.com',
  'icloud.com',
  'tin.it',
  'virgilio.it',
  'alice.it',
  'tiscali.it',
  'pec.it',
  'pec.legalmail.it',
  'pec.aruba.it',
  'pec.poste.it',
]);

function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase().trim();
}

/**
 * Esegue tutti i check tra Company referente e Company referral. Ritorna
 * la lista di flag sollevati. Se l'array è vuoto: nessun sospetto.
 */
export async function detectCollusion(
  tx: Prisma.TransactionClient,
  referenteCompanyId: string,
  referralCompanyId: string,
): Promise<CollusionFlag[]> {
  if (referenteCompanyId === referralCompanyId) {
    // Auto-affiliazione: spec §1.2 triage la consente. Non flag-ghiamo.
    return [];
  }

  const [referente, referral] = await Promise.all([
    tx.company.findUnique({
      where: { id: referenteCompanyId },
      select: {
        id: true,
        iban: true,
        signupIp: true,
        email: true,
        // Multi-sede: considera anche gli IBAN delle sedi nel check SAME_IBAN.
        sedi: { select: { iban: true } },
      },
    }),
    tx.company.findUnique({
      where: { id: referralCompanyId },
      select: {
        id: true,
        iban: true,
        signupIp: true,
        email: true,
        sedi: { select: { iban: true } },
      },
    }),
  ]);

  if (!referente || !referral) return [];

  const flags: CollusionFlag[] = [];

  // SAME_IBAN: stesso conto bancario (madre o una qualsiasi sede di una madre).
  const normIban = (s: string) => s.replace(/\s+/g, '').toUpperCase();
  const ibansOf = (c: { iban: string | null; sedi: { iban: string | null }[] }): Set<string> =>
    new Set(
      [c.iban, ...c.sedi.map((s) => s.iban)].filter((x): x is string => !!x).map(normIban),
    );
  const refIbans = ibansOf(referente);
  const reflIbans = ibansOf(referral);
  if ([...refIbans].some((i) => reflIbans.has(i))) {
    flags.push('SAME_IBAN');
  }

  // SAME_IP_SIGNUP: registrati dalla stessa rete
  if (
    referente.signupIp &&
    referral.signupIp &&
    referente.signupIp === referral.signupIp
  ) {
    flags.push('SAME_IP_SIGNUP');
  }

  // SAME_EMAIL_DOMAIN: stesso dominio aziendale (escludendo i generici)
  const refDomain = emailDomain(referente.email);
  const reflDomain = emailDomain(referral.email);
  if (
    refDomain &&
    reflDomain &&
    refDomain === reflDomain &&
    !PUBLIC_EMAIL_DOMAINS.has(refDomain)
  ) {
    flags.push('SAME_EMAIL_DOMAIN');
  }

  // SAME_ADMIN: stesso utente admin tra le due company (multi-tenancy
  // dovrebbe escluderlo, ma controllo difensivo).
  const sharedAdmin = await tx.user.findFirst({
    where: {
      role: 'ADMIN_AZIENDA',
      deletedAt: null,
      companyId: { in: [referenteCompanyId, referralCompanyId] },
    },
    select: { email: true, companyId: true },
  });
  if (sharedAdmin) {
    // Cerca un admin la cui email è anche admin dell'altra company
    const otherAdmin = await tx.user.findFirst({
      where: {
        role: 'ADMIN_AZIENDA',
        deletedAt: null,
        email: sharedAdmin.email,
        companyId: {
          in: [referenteCompanyId, referralCompanyId],
          not: sharedAdmin.companyId,
        },
      },
      select: { id: true },
    });
    if (otherAdmin) flags.push('SAME_ADMIN');
  }

  return flags;
}

