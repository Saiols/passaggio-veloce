'use client';

import { useRef } from 'react';

type Option = { value: string; label: string };

type Props = {
  da: string;
  a: string;
  sede?: string;
  /** Passato solo per il proprietario: abilita il filtro sede. */
  sedi?: Option[];
};

const CONTROL =
  'rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-3 py-2.5 text-sm font-medium text-pv-slate-900 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)]';
const LABEL = 'flex flex-col gap-1 text-[12px] font-semibold text-pv-slate-500';

export function FeedbackFilters({ da, a, sede, sedi }: Props) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const submit = () => formRef.current?.requestSubmit();

  return (
    <form
      ref={formRef}
      action="/feedback"
      method="get"
      className="mb-5 flex flex-col gap-3 rounded-[16px] border border-pv-slate-200 bg-white p-4 shadow-[var(--pv-shadow-card)] sm:flex-row sm:flex-wrap sm:items-end"
    >
      <label className={LABEL}>
        Da
        <input type="date" name="da" defaultValue={da} onChange={submit} className={CONTROL} />
      </label>
      <label className={LABEL}>
        A
        <input type="date" name="a" defaultValue={a} onChange={submit} className={CONTROL} />
      </label>
      {sedi && (
        <label className={`${LABEL} sm:ml-auto`}>
          Sede
          <select name="sede" defaultValue={sede ?? ''} onChange={submit} className={CONTROL}>
            {sedi.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </form>
  );
}
