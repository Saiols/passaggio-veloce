'use client';

import { useEffect, useRef } from 'react';

type Option = { value: string; label: string };

type Props = {
  q?: string;
  stato?: string;
  periodo?: string;
  sede?: string;
  stati: Option[];
  periodi: Option[];
  /** Vuoto quando la colonna Sede non si mostra: la select sparisce. */
  sedi: Option[];
};

export function PraticheFilters({ q, stato, periodo, sede, stati, periodi, sedi }: Props) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
  }, []);

  const submit = () => formRef.current?.requestSubmit();

  const onTextChange = () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(submit, 350);
  };

  return (
    <form
      ref={formRef}
      action="/pratiche"
      method="get"
      className={`mb-5 grid grid-cols-1 gap-3 rounded-[16px] border border-pv-slate-200 bg-white p-4 shadow-[var(--pv-shadow-card)] ${
        sedi.length > 0 ? 'sm:grid-cols-[1fr_auto_auto_auto]' : 'sm:grid-cols-[1fr_auto_auto]'
      }`}
    >
      <input
        name="q"
        defaultValue={q ?? ''}
        placeholder="Cerca per codice, targa, proprietario…"
        onChange={onTextChange}
        className="block w-full rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-[14px] py-2.5 text-sm font-medium text-pv-slate-900 placeholder:text-pv-slate-500 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)]"
      />
      <select
        name="stato"
        defaultValue={stato ?? ''}
        onChange={submit}
        className="rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-3 py-2.5 text-sm font-medium text-pv-slate-900 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)]"
      >
        {stati.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <select
        name="periodo"
        defaultValue={periodo ?? ''}
        onChange={submit}
        className="rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-3 py-2.5 text-sm font-medium text-pv-slate-900 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)]"
      >
        {periodi.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      {sedi.length > 0 && (
        <select
          name="sede"
          defaultValue={sede ?? ''}
          onChange={submit}
          className="rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-3 py-2.5 text-sm font-medium text-pv-slate-900 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)]"
        >
          {sedi.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      )}
    </form>
  );
}
