import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { prisma } from '@pv/db';
import { authConfig } from './auth.config';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
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
          where: {
            email: email.toLowerCase(),
            deletedAt: null,
            status: { not: 'SUSPENDED' },
          },
          include: { company: true },
          orderBy: [{ companyId: 'asc' }, { createdAt: 'asc' }],
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
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.status = user.status;
        token.companyId = user.companyId;
        token.companyType = user.companyType;
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
      }
      return session;
    },
  },
});
