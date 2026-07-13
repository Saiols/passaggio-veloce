'use client';

import { useEffect, useRef } from 'react';

type Option = { value: string; label: string };

type Props = {
  q?: string;
  stato?: string;
  sede?: string;
  stati: Option[];
  sedi: Option[];
};

export function AdminPraticheFilters({ q, stato, sede, stati, sedi }: Props) {
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
      action="/admin/pratiche"
      method="get"
      className="mb-5 grid grid-cols-1 gap-3 rounded-[16px] border border-pv-slate-200 bg-white p-4 shadow-[var(--pv-shadow-card)] sm:grid-cols-[1fr_auto_auto]"
    >
      <input
        name="q"
        defaultValue={q ?? ''}
        placeholder="Cerca per codice, targa, broker, agenzia, comune…"
        onChange={onTextChange}
        className="block w-full rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-[14px] py-2.5 text-sm font-medium text-pv-slate-900 placeholder:text-pv-slate-500 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)]"
      />
      <select
        // I tab sono <Link> (soft nav): il componente non si rimonta quando
        // cambia `?stato=`, riceve solo la nuova prop. Una select uncontrolled
        // applica `defaultValue` SOLO al mount (React ignora l'update se
        // `value` è null), quindi senza questa `key` il DOM resterebbe fermo
        // sul tab precedente finché non lo si tocca a mano — e a quel punto
        // il form riparte con lo stato vecchio, non quello del tab cliccato.
        // La `key` forza il remount della sola select (mai del form/input
        // ricerca, che ha debounce e perderebbe il focus).
        key={stato ?? ''}
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
    </form>
  );
}
