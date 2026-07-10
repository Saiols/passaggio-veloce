import type { PraticaTipo } from '@pv/db';
import { labelTipoPratica } from '@/lib/pratiche/label-tipo';
import { cn } from './cn';

/**
 * Chip con la tipologia della pratica (Semplice / Semplice Multiplo /
 * Minivoltura / Minivoltura multipla). Le pratiche multiple hanno un accent
 * navy per distinguerle a colpo d'occhio. Non-uppercase: l'etichetta ha una
 * capitalizzazione voluta.
 */
export function TipoPraticaChip({
  tipo,
  numeroVeicoli,
  className,
}: {
  tipo: PraticaTipo;
  numeroVeicoli: number;
  className?: string;
}) {
  const multiplo = numeroVeicoli > 1;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
        multiplo ? 'bg-pv-navy-100 text-pv-navy-700' : 'bg-pv-slate-100 text-pv-slate-600',
        className,
      )}
    >
      {labelTipoPratica({ tipo, numeroVeicoli })}
    </span>
  );
}
