'use client';

import { useState } from 'react';
import { hasBlockingErrors, type FieldErrorsMap } from './zod-field-errors';

export type FieldState = {
  invalid: boolean;
  error: string | undefined;
  onBlur: () => void;
};

/**
 * Stato di validazione di un form a componente singolo. Riceve la mappa
 * campo→messaggio (da `zodFieldErrors`) e applica la regola di visibilità:
 * un campo mostra bordo+messaggio SOLO se toccato (blur) o dopo un submit
 * (reveal). All'apertura nessun campo è in errore.
 */
export function useFieldErrorsState(errors: FieldErrorsMap) {
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [revealed, setRevealed] = useState(false);

  const touch = (key: string): void =>
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));

  const field = (key: string): FieldState => {
    const show = (touched.has(key) || revealed) && errors[key] ? errors[key] : undefined;
    return { invalid: Boolean(show), error: show, onBlur: () => touch(key) };
  };

  const reveal = (): void => setRevealed(true);
  const resetReveal = (): void => setRevealed(false);

  const gatedSubmit =
    (onValid: () => void) =>
    (e: { preventDefault: () => void }): void => {
      e.preventDefault();
      setRevealed(true);
      if (hasBlockingErrors(errors)) return;
      onValid();
    };

  return { field, gatedSubmit, reveal, resetReveal, revealed };
}
