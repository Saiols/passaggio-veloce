import type { NextAuthConfig } from 'next-auth';

// Edge-compatible config (no Node-only modules like bcryptjs).
// Used by middleware.ts. Full config with Credentials provider lives in auth.ts.

// Pagine pubbliche della vetrina marketing: home + pagine legali. Sono
// accessibili senza login e sono l'unico contenuto raggiungibile quando il
// gate pre-lancio LANDING_ONLY è attivo.
const PUBLIC_PATHS = new Set(['/', '/privacy', '/cookie', '/termini']);

export const authConfig = {
  trustHost: true,
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const path = nextUrl.pathname;

      // Gate pre-lancio: con LANDING_ONLY="true" è raggiungibile solo la
      // vetrina marketing pubblica; ogni altra rotta torna alla home.
      // Si disattiva rimuovendo la env var LANDING_ONLY al go-live.
      if (process.env.LANDING_ONLY === 'true' && !PUBLIC_PATHS.has(path)) {
        return Response.redirect(new URL('/', nextUrl));
      }

      const isLoggedIn = Boolean(auth?.user);
      const isOnAuthPage =
        path.startsWith('/login') ||
        path.startsWith('/register') ||
        path.startsWith('/reset-password') ||
        path.startsWith('/verify-email');

      if (isOnAuthPage) {
        if (isLoggedIn) {
          return Response.redirect(new URL('/dashboard', nextUrl));
        }
        return true;
      }

      if (PUBLIC_PATHS.has(path)) return true;

      // Everything else requires auth.
      return isLoggedIn;
    },
  },
  providers: [], // Filled in auth.ts (Node runtime).
} satisfies NextAuthConfig;
