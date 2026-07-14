'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { InlineSpinner } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { revocaOpposizioneCatalogoAction } from './actions';

/**
 * Revoca un'opposizione GDPR art. 21 già registrata: l'interessato può
 * cambiare idea, è legittimo. Il contatto ricompare nel catalogo (ed export
 * CSV) alla chiamata successiva.
 */
export function RevocaOpposizioneCatalogoButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onClick = (): void => {
    if (
      !confirm(
        'Revocare questa opposizione? Il contatto ricomparirà nel catalogo e nell’export CSV.',
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await revocaOpposizioneCatalogoAction(id);
      if (res.ok) router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-busy={pending || undefined}
      className="inline-flex items-center gap-1 text-[12px] font-semibold text-pv-navy-700 hover:underline disabled:opacity-50"
    >
      {pending && <InlineSpinner className="h-3 w-3" />}
      <span>{pending ? 'Revoca…' : 'Revoca'}</span>
      <LoadingOverlay show={pending} label="Revoca…" />
    </button>
  );
}
