'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

type ToastVariant = 'success' | 'error' | 'info';
type ToastItem = { id: number; message: string; variant: ToastVariant };

const ToastCtx = createContext<
  ((message: string, variant?: ToastVariant) => void) | null
>(null);

const noop = (): void => {};

/**
 * Hook per emettere un toast. Fuori dal provider ritorna un no-op (così i
 * componenti riutilizzabili non crashano se montati in una shell senza Toaster,
 * es. AdminShell).
 */
export function useToast(): (message: string, variant?: ToastVariant) => void {
  return useContext(ToastCtx) ?? noop;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, variant: ToastVariant = 'success') => {
      const id = nextId++;
      setItems((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => remove(id), 4000);
    },
    [remove],
  );

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={
              'pointer-events-auto flex items-center gap-2 rounded-[10px] px-4 py-3 text-[13px] font-semibold text-white shadow-[var(--pv-shadow-card-lg)] ' +
              (t.variant === 'success'
                ? 'bg-pv-green-500'
                : t.variant === 'error'
                  ? 'bg-pv-red-500'
                  : 'bg-pv-navy-700')
            }
          >
            <span aria-hidden="true">
              {t.variant === 'success' ? '✓' : t.variant === 'error' ? '!' : 'ℹ'}
            </span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
