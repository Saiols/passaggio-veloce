import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { env } from '@/env';

const CONTATTACI_HREF =
  'mailto:info@passaggioveloce.it?subject=' +
  encodeURIComponent('Richiesta accesso Passaggio Veloce');

type Props = {
  variant?: 'marketing' | 'auth';
};

export function SiteHeader({ variant = 'marketing' }: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-pv-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5 sm:px-6">
        <Link href="/" className="flex items-center">
          <Image
            src="/brand/logo-primary.svg"
            alt="Passaggio Veloce"
            width={214}
            height={36}
            className="h-9 w-auto"
            priority
          />
        </Link>
        <nav className="flex items-center gap-2">
          {variant === 'auth' ? (
            <Link
              href="/"
              className="text-[13px] font-semibold text-pv-slate-500 transition-colors hover:text-pv-navy-700"
            >
              Torna al sito
            </Link>
          ) : env.LANDING_ONLY ? (
            // Pre-lancio: niente login/registrazione pubblici, solo contatto.
            <a href={CONTATTACI_HREF}>
              <Button size="sm">Contattaci</Button>
            </a>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Accedi
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm">Registrati</Button>
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
