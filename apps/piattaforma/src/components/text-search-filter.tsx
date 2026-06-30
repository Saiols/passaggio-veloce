'use client';

import { useEffect, useRef } from 'react';

type Props = {
  action: string;
  q?: string;
  placeholder: string;
  /** Parametri da preservare nel submit GET (es. un filtro `ruolo` attivo),
   *  resi come input hidden così non vengono persi quando si cerca. */
  hidden?: Record<string, string>;
};

/**
 * Form GET con singolo campo `q` e auto-submit con debounce 350ms.
 * Riusato per liste admin (utenti, agenzie). Nessun pulsante "Cerca/Filtra"
 * per spec Q-06/Q-13: la ricerca è inline.
 */
export function TextSearchFilter({ action, q, placeholder, hidden }: Props) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
  }, []);

  const onChange = () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(
      () => formRef.current?.requestSubmit(),
      350,
    );
  };

  return (
    <form
      ref={formRef}
      action={action}
      method="get"
      className="mb-5 rounded-[16px] border border-pv-slate-200 bg-white p-4 shadow-[var(--pv-shadow-card)]"
    >
      {hidden &&
        Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      <input
        name="q"
        defaultValue={q ?? ''}
        placeholder={placeholder}
        onChange={onChange}
        className="block w-full rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-[14px] py-2.5 text-sm font-medium text-pv-slate-900 placeholder:text-pv-slate-500 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)]"
      />
    </form>
  );
}
