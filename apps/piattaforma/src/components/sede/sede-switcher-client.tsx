'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setCurrentSedeAction } from '@/lib/sedi/actions';

/**
 * Selettore della sede operativa corrente. Il proprietario (isOwner) ha anche
 * l'opzione "Tutte le sedi" (vista aggregata). Al cambio scrive il cookie via
 * server action e ricarica la pagina per ri-scoping.
 */
export function SedeSwitcherClient({
  sedi,
  current,
  isOwner,
}: {
  sedi: { id: string; nome: string }[];
  current: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <label className="flex items-center gap-2 text-[12.5px] text-pv-slate-600">
      <span className="font-semibold uppercase tracking-wider text-[11px] text-pv-slate-500">
        Sede
      </span>
      <select
        value={current}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          start(async () => {
            await setCurrentSedeAction(v);
            router.refresh();
          });
        }}
        className="rounded-[8px] border-[1.5px] border-pv-slate-200 bg-white px-2.5 py-1 text-[13px] font-medium text-pv-navy-900 focus:border-pv-navy-600 focus:outline-none focus:shadow-[var(--pv-ring-focus)] disabled:opacity-60"
      >
        {isOwner && <option value="ALL">Tutte le sedi</option>}
        {sedi.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nome}
          </option>
        ))}
      </select>
    </label>
  );
}
