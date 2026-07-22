import type { NextAuthConfig } from 'next-auth';
import { isLandingOnlyHost, isPublicPath } from '@/lib/landing-gate';

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

      // Gate vetrina pre-lancio (flag LANDING_ONLY in src/lib/landing-gate.ts):
      // quando ATTIVO, sui domini di produzione (GATED_HOSTS) è raggiungibile
      // solo la vetrina marketing pubblica. A go-live avvenuto (LANDING_ONLY=
      // false) e sugli altri host (Vercel + preview) l'app è accessibile ovunque.
      //
      // Importante: il redirect usa esplicitamente `https://${host}/`
      // invece di `new URL('/', nextUrl)`. Su Vercel, quando AUTH_URL
      // env var è settata, nextUrl.origin può essere normalizzato all'URL
      // canonico Auth.js (es. passaggio-veloce-piattaforma.vercel.app) →
      // chi tenta /login su passaggioveloce.it finirebbe su .vercel.app
      // dove il gate è spento, vanificando il gate stesso.
      const host = request.headers.get('host');
      if (isLandingOnlyHost(host) && !isPublicPath(path)) {
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

      // Link referral pubblico: l'utente ANONIMO clicca /r/<code>, la route
      // logga il click e redirige a /register?ref=<code>. Deve quindi essere
      // raggiungibile senza login (è l'ingresso dell'affiliazione).
      if (path.startsWith('/r/')) return true;

      // Link "email di partenza" CRM: il lead ANONIMO clicca /i/<token>, la
      // route traccia l'apertura e redirige a /register/...?promo=<code>. Come
      // /r/, deve essere raggiungibile senza login (nessun account esiste ancora).
      if (path.startsWith('/i/')) return true;

      if (isPublicPath(path)) return true;

      // Everything else requires auth.
      return isLoggedIn;
    },
  },
  providers: [], // Filled in auth.ts (Node runtime).
} satisfies NextAuthConfig;
