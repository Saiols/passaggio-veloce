import type { NextAuthConfig } from 'next-auth';
import { isGatedHost, PUBLIC_PATHS } from '@/lib/landing-gate';

// Edge-compatible config (no Node-only modules like bcryptjs).
// Used by middleware.ts. Full config with Credentials provider lives in auth.ts.

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
    authorized({ auth, request }) {
      const { nextUrl } = request;
      const path = nextUrl.pathname;

      // Gate pre-lancio host-based: sui domini in GATED_HOSTS
      // (vedi src/lib/landing-gate.ts) è raggiungibile solo la vetrina
      // marketing pubblica. Sugli altri host (Vercel default + preview)
      // l'app è completamente accessibile.
      //
      // Importante: il redirect usa esplicitamente `https://${host}/`
      // invece di `new URL('/', nextUrl)`. Su Vercel, quando AUTH_URL
      // env var è settata, nextUrl.origin può essere normalizzato all'URL
      // canonico Auth.js (es. passaggio-veloce-piattaforma.vercel.app) →
      // chi tenta /login su passaggioveloce.it finirebbe su .vercel.app
      // dove il gate è spento, vanificando il gate stesso.
      const host = request.headers.get('host');
      if (isGatedHost(host) && !PUBLIC_PATHS.has(path)) {
        return Response.redirect(`https://${host}/`);
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
