'use client';

import { useEffect, useRef } from 'react';

type Props = {
  action: string;
  q?: string;
  placeholder: string;
  /** Parametri da preservare nel submit GET (es. un filtro `ruolo` attivo),
   *  resi come input hidden così non vengono persi quando si cerca. */
  hidden?: Record<string, string>;
  /** Tendina di filtro accanto alla ricerca. Vive nello stesso form GET, così
   *  i due filtri si combinano invece di sovrascriversi. Submit immediato. */
  select?: {
    name: string;
    value?: string;
    ariaLabel: string;
    options: { value: string; label: string }[];
  };
};

/**
 * Form GET con campo `q` (auto-submit, debounce 350ms) e tendina opzionale
 * (submit immediato). Riusato per liste admin (utenti, agenzie). Nessun
 * pulsante "Cerca/Filtra" per spec Q-06/Q-13: la ricerca è inline.
 */
export function TextSearchFilter({ action, q, placeholder, hidden, select }: Props) {
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

  // La tendina non aspetta il debounce: la scelta è già definitiva.
  const onSelectChange = () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    formRef.current?.requestSubmit();
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
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder={placeholder}
          onChange={onChange}
          className="w-full flex-1 rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-[14px] py-2.5 text-sm font-medium text-pv-slate-900 placeholder:text-pv-slate-500 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)]"
        />
        {select && (
          <select
            name={select.name}
            defaultValue={select.value ?? ''}
            aria-label={select.ariaLabel}
            onChange={onSelectChange}
            className="w-full rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-[14px] py-2.5 text-sm font-medium text-pv-slate-900 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)] sm:w-[190px]"
          >
            {select.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </form>
  );
}
