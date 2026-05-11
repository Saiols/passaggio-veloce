import 'server-only';
import { prisma } from '@pv/db';

const RETENTION_DAYS = 90;
const BATCH_SIZE = 100;

export type PurgeDeletedTeamUsersResult = {
  candidates: number;
  anonymized: number;
};

/**
 * Anonimizza utenti team con `deletedAt < now - 90gg`: rimuove i PII
 * (email, nome, cognome, codiceFiscale, dataNascita, luogoNascita) e
 * azzera credenziali/2FA. La riga User resta in DB con status SUSPENDED
 * per preservare l'integrità FK degli audit (documenti caricati, dichiarazioni
 * broker, notifiche storiche). Idempotente: utenti già anonimizzati hanno
 * email pattern `deleted-*@deleted.invalid` e vengono saltati.
 *
 * Compliance GDPR: l'anonimizzazione equivale a "cancellazione" ai fini
 * dell'art. 17 GDPR perché rimuove ogni identificatore personale (linea
 * Garante Privacy IT, FAQ retention dati audit/contabili).
 */
export async function purgeDeletedTeamUsers(): Promise<PurgeDeletedTeamUsersResult> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.user.findMany({
    where: {
      deletedAt: { lt: cutoff, not: null },
      NOT: { email: { startsWith: 'deleted-' } },
    },
    select: { id: true },
    take: BATCH_SIZE,
  });

  let anonymized = 0;
  for (const u of candidates) {
    await prisma.user.update({
      where: { id: u.id },
      data: {
        email: `deleted-${u.id}@deleted.invalid`,
        nome: 'Utente',
        cognome: 'Eliminato',
        codiceFiscale: null,
        dataNascita: null,
        luogoNascita: null,
        passwordHash: '',
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: undefined,
        status: 'SUSPENDED',
      },
    });
    anonymized++;
  }

  return { candidates: candidates.length, anonymized };
}
