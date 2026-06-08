'use client';

import type { InputHTMLAttributes } from 'react';
import { forwardRef, useRef, useState } from 'react';
import { cn } from './cn';

// ── Helper puri (testabili) ────────────────────────────────────────────────

/** Parsa il testo grezzo in numero. Restituisce null se vuoto/incompleto
 *  (es. "", "-", ".") o non numerico. Accetta la virgola come separatore. */
export function parseNumberInput(raw: string, integer = false): number | null {
  const t = raw.trim().replace(',', '.');
  if (t === '' || t === '-' || t === '.' || t === '-.') return null;
  const n = integer ? parseInt(t, 10) : Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Limita n all'intervallo [min, max] (estremi opzionali). */
export function clampNumberInput(n: number, min?: number, max?: number): number {
  let v = n;
  if (typeof min === 'number' && v < min) v = min;
  if (typeof max === 'number' && v > max) v = max;
  return v;
}

/**
 * Normalizza il valore all'uscita dal campo (blur):
 * - testo numerico  → numero clampato a [min, max];
 * - vuoto/incompleto → se allowEmpty è null; altrimenti il fallback (ultimo
 *   valore valido) oppure il min, così il campo non resta mai vuoto.
 */
export function commitNumberInput(
  raw: string,
  opts: {
    min?: number;
    max?: number;
    integer?: boolean;
    allowEmpty?: boolean;
    fallback?: number | null;
  },
): number | null {
  const parsed = parseNumberInput(raw, opts.integer);
  if (parsed === null) {
    if (opts.allowEmpty) return null;
    const fb = opts.fallback ?? opts.min ?? null;
    return fb === null ? null : clampNumberInput(fb, opts.min, opts.max);
  }
  return clampNumberInput(parsed, opts.min, opts.max);
}

function format(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? '' : String(value);
}

// ── Componente ─────────────────────────────────────────────────────────────

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange' | 'type'
> & {
  /** Valore controllato (number) oppure null per campo vuoto. */
  value?: number | null;
  /** Seed iniziale per uso non controllato (form nativi con `name`). */
  defaultValue?: number | null;
  /** Chiamato col valore normalizzato all'uscita dal campo (blur / Invio). */
  onChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number | string;
  /** Parsa come intero. */
  integer?: boolean;
  /** Consenti il campo vuoto (null). Default: false → al blur torna a min/ultimo valore. */
  allowEmpty?: boolean;
  invalid?: boolean;
};

const base =
  'block w-full rounded-[10px] px-[14px] py-3 text-sm font-medium text-pv-slate-900 ' +
  'placeholder:text-pv-slate-500 ' +
  'bg-pv-navy-100 border border-[1.5px] border-transparent ' +
  'transition-[background,border-color,box-shadow] duration-150 ease-out ' +
  'focus:bg-white focus:border-pv-navy-600 focus:shadow-[var(--pv-ring-focus)] focus:outline-none ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

const errorCls =
  'border-pv-red-500 bg-pv-red-50/70 focus:border-pv-red-500 focus:shadow-[var(--pv-ring-error)]';

/**
 * Campo numerico (type=number, frecce mantenute) con editing libero:
 * mentre digiti tiene una bozza testuale — puoi cancellare e riscrivere quel
 * che vuoi — e normalizza/clampa solo all'uscita dal campo (blur o Invio).
 * Lo scroll della rotellina è neutralizzato globalmente (NumberInputWheelGuard).
 */
export const NumberInput = forwardRef<HTMLInputElement, Props>(function NumberInput(
  {
    value,
    defaultValue,
    onChange,
    onBlur,
    onKeyDown,
    min,
    max,
    step,
    integer,
    allowEmpty,
    invalid,
    className,
    'aria-invalid': ariaInvalid,
    ...rest
  },
  ref,
) {
  const controlled = value !== undefined;
  const [draft, setDraft] = useState<string>(() =>
    format(controlled ? value : defaultValue),
  );
  const [syncedValue, setSyncedValue] = useState(value);
  const lastValid = useRef<number | null>(
    (controlled ? value : defaultValue) ?? null,
  );
  const isInvalid = invalid ?? (ariaInvalid === true || ariaInvalid === 'true');

  // Sincronizza la bozza quando la prop controllata cambia dall'esterno o al
  // commit. Con il commit-al-blur il `value` non cambia mentre si digita, quindi
  // questa condizione non scatta durante l'editing e non sovrascrive la bozza.
  // Pattern React: si adatta lo stato durante il render (con un valore-precedente
  // di guardia) — niente useEffect e niente accesso a ref nel render.
  if (controlled && value !== syncedValue) {
    setSyncedValue(value);
    setDraft(format(value));
  }

  // commit() gira solo da event handler (blur / Invio): qui l'accesso al ref è
  // lecito. Per i campi controllati il fallback è il `value` corrente (ultimo
  // valore esterno); per quelli non controllati l'ultimo valore valido digitato.
  const commit = (): void => {
    const fallback = controlled ? value ?? null : lastValid.current;
    const committed = commitNumberInput(draft, {
      min,
      max,
      integer,
      allowEmpty,
      fallback,
    });
    if (!controlled && committed !== null) lastValid.current = committed;
    setDraft(format(committed));
    onChange?.(committed);
  };

  return (
    <input
      {...rest}
      ref={ref}
      type="number"
      inputMode={integer ? 'numeric' : 'decimal'}
      min={min}
      max={max}
      step={step}
      value={draft}
      aria-invalid={isInvalid || undefined}
      className={className ?? cn(base, isInvalid && errorCls)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        commit();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        onKeyDown?.(e);
      }}
    />
  );
});
