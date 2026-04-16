import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/site-header';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SiteHeader variant="auth" />
      <main className="flex flex-1 flex-col">{children}</main>
      <footer className="border-t border-pv-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 text-[12px] text-pv-slate-500 sm:px-6">
          <p>© {new Date().getFullYear()} Passaggio Veloce</p>
          <p>Broker digitale automotive</p>
        </div>
      </footer>
    </div>
  );
}
