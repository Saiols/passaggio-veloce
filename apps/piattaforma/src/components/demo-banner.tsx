import Link from 'next/link';
import { env } from '@/env';

export function DemoBanner({ isAdmin }: { isAdmin: boolean }) {
  if (!env.DEMO_MODE) return null;
  return (
    <div className="bg-yellow-300 border-b border-yellow-500 text-yellow-950">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-5 py-2 text-[12.5px] font-semibold sm:px-6">
        <span>
          🧪 <span className="font-extrabold">Modalità DEMO</span> — Email,
          pagamenti, OCR e cron sono simulati.
        </span>
        {isAdmin ? (
          <Link
            href="/admin/demo-control"
            className="underline decoration-yellow-700 underline-offset-2 hover:text-yellow-900"
          >
            Demo Control →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
