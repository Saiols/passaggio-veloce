'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/** Un campo è "in errore" solo se è stato toccato (blur) oppure se lo step è in
 *  reveal (clic sul CTA disabilitato), e non è valido. Alla prima apertura
 *  (né touched né reveal) nessun campo è in errore. Puro, testabile. */
export function computeInvalid(args: { touched: boolean; reveal: boolean; valid: boolean }): boolean {
  return (args.touched || args.reveal) && !args.valid;
}

type FieldErrorsCtx = {
  isInvalid: (key: string, valid: boolean) => boolean;
  /** Messaggio-motivo da passare a `Field error=`: `message` se il campo è in
   *  errore (stessa regola di `isInvalid`), altrimenti `undefined`. */
  err: (key: string, valid: boolean, message: string) => string | undefined;
  touch: (key: string) => void;
  reveal: () => void;
  resetReveal: () => void;
};

const Ctx = createContext<FieldErrorsCtx | null>(null);

/** Provider a livello wizard. `reveal` vale per lo step corrente (si azzera al
 *  cambio step via `resetReveal`). `touched` persiste per l'intera sessione. */
export function FieldErrorsProvider({ children }: { children: ReactNode }) {
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [revealed, setRevealed] = useState(false);

  const touch = useCallback((key: string) => {
    setTouched((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);
  const reveal = useCallback(() => setRevealed(true), []);
  const resetReveal = useCallback(() => setRevealed(false), []);
  const isInvalid = useCallback(
    (key: string, valid: boolean) => computeInvalid({ touched: touched.has(key), reveal: revealed, valid }),
    [touched, revealed],
  );
  const err = useCallback(
    (key: string, valid: boolean, message: string) => (isInvalid(key, valid) ? message : undefined),
    [isInvalid],
  );

  const value = useMemo(
    () => ({ isInvalid, err, touch, reveal, resetReveal }),
    [isInvalid, err, touch, reveal, resetReveal],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFieldErrors(): FieldErrorsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useFieldErrors deve stare dentro FieldErrorsProvider');
  return ctx;
}
