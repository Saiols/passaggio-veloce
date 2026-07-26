'use client';

import { useRef } from 'react';
import type { TipoFiltro } from '@/lib/finanze/periodo';

const CONTROL =
  'rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-3 py-2.5 text-sm font-medium text-pv-slate-900 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)]';
const LABEL = 'flex flex-col gap-1 text-[12px] font-semibold text-pv-slate-500';

/**
 * Campi data del periodo personalizzato. `periodo` e `tipo` viaggiano come
 * hidden: senza di loro il submit del form perderebbe il tab attivo e il
 * filtro tipo pratica, riportando la pagina al default.
 */
export function FiltriPeriodoCustom({
  da,
  a,
  tipo,
}: {
  da: string;
  a: string;
  tipo: TipoFiltro;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const submit = () => formRef.current?.requestSubmit();

  return (
    <form
      ref={formRef}
      action="/admin/dashboard"
      method="get"
      className="mt-3 flex flex-col gap-3 rounded-[16px] border border-pv-slate-200 bg-white p-4 shadow-[var(--pv-shadow-card)] sm:flex-row sm:flex-wrap sm:items-end"
    >
      <input type="hidden" name="periodo" value="custom" />
      {tipo ? <input type="hidden" name="tipo" value={tipo} /> : null}
      <label className={LABEL}>
        Da
        <input type="date" name="da" defaultValue={da} onChange={submit} className={CONTROL} />
      </label>
      <label className={LABEL}>
        A
        <input type="date" name="a" defaultValue={a} onChange={submit} className={CONTROL} />
      </label>
    </form>
  );
}
