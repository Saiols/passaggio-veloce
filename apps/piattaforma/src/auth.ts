import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { prisma } from '@pv/db';
import { authConfig } from './auth.config';
import { verifyTwoFactor } from '@/lib/auth/totp';
import { activeUserCredentialsQuery } from '@/lib/auth/credentials-query';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().optional(),
});

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totp: { label: 'Codice 2FA', type: 'text' },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        // Multi-tenancy email scope-company (item 07 release 2026-05): la
        // stessa email puo' esistere su piu' User (uno per company). Cerchiamo
        // tutti i match attivi e verifichiamo la password contro ognuno.
        // L'admin platform (companyId=null) prevale per disambiguare in caso
        // di hash uguali, poi viene il primo per createdAt.
        const candidates = await prisma.user.findMany({
          ...activeUserCredentialsQuery(email.toLowerCase()),
          include: { company: true },
        });

        if (candidates.length === 0) return null;

        let matched: (typeof candidates)[number] | null = null;
        for (const c of candidates) {
          const ok = await bcrypt.compare(password, c.passwordHash);
          if (ok) {
            matched = c;
            break;
          }
        }
        if (!matched) return null;

        // P4: se il 2FA è attivo, il codice TOTP (o un backup code) è obbligatorio.
        // authorize è la fonte autoritativa: consuma il backup code se usato.
        if (matched.twoFactorEnabled) {
          const code = parsed.data.totp ?? '';
          const backupHashes = Array.isArray(matched.twoFactorBackupCodes)
            ? (matched.twoFactorBackupCodes as string[])
            : [];
          const res = await verifyTwoFactor(
            { secret: matched.twoFactorSecret, backupCodeHashes: backupHashes },
            code,
          );
          if (!res.ok) return null;
          if (res.consumedBackupIndex !== null) {
            const remaining = backupHashes.filter((_, i) => i !== res.consumedBackupIndex);
            await prisma.user.update({
              where: { id: matched.id },
              data: { twoFactorBackupCodes: remaining },
            });
          }
        }

        await prisma.user.update({
          where: { id: matched.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: matched.id,
          email: matched.email,
          name: `${matched.nome} ${matched.cognome}`,
          role: matched.role,
          status: matched.status,
          companyId: matched.companyId ?? undefined,
          companyType: matched.company?.type ?? undefined,
          companyName: matched.company?.ragioneSociale ?? undefined,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.status = user.status;
        token.companyId = user.companyId;
        token.companyType = user.companyType;
        token.companyName = user.companyName;
      }
      // Refresh dei dati identità mutabili quando la sessione viene aggiornata
      // via unstable_update (es. l'utente ha cambiato l'email di accesso dal
      // profilo): senza questo il token — e quindi header/menu — resterebbe con
      // email/nome del login fino al re-login. Il DB è la fonte autoritativa.
      if (trigger === 'update' && token.id) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { email: true, nome: true, cognome: true, status: true },
        });
        if (fresh) {
          token.email = fresh.email;
          token.name = `${fresh.nome} ${fresh.cognome}`;
          token.status = fresh.status;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.status = token.status as string;
        session.user.companyId = token.companyId as string | undefined;
        session.user.companyType = token.companyType as string | undefined;
        session.user.companyName = token.companyName as string | undefined;
      }
      return session;
    },
  },
});
