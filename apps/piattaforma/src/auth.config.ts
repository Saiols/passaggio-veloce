import type { NextAuthConfig } from 'next-auth';

// Edge-compatible config (no Node-only modules like bcryptjs).
// Used by middleware.ts. Full config with Credentials provider lives in auth.ts.
export const authConfig = {
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = Boolean(auth?.user);
      const isOnAuthPage =
        nextUrl.pathname.startsWith('/login') ||
        nextUrl.pathname.startsWith('/register') ||
        nextUrl.pathname.startsWith('/reset-password') ||
        nextUrl.pathname.startsWith('/verify-email');

      const isPublicPage = nextUrl.pathname === '/';

      if (isOnAuthPage) {
        if (isLoggedIn) {
          return Response.redirect(new URL('/dashboard', nextUrl));
        }
        return true;
      }

      if (isPublicPage) return true;

      // Everything else requires auth.
      return isLoggedIn;
    },
  },
  providers: [], // Filled in auth.ts (Node runtime).
} satisfies NextAuthConfig;
