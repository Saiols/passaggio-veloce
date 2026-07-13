import type { FatturaPaTipo } from '@pv/db';
import { statoEmissione, labelEmissione } from '@/lib/fatturazione/emissione';
import { cn } from './cn';

/**
 * Stato di emissione di un documento fiscale. Tre valori, non due: "Fuori campo
 * SdI" (grigio/neutro) NON è un'omissione da sanare, è un documento che per
 * legge non va allo SdI — colorarlo come un problema (ambra) spingerebbe il
 * commercialista a "sistemarlo", cioè a emettere un documento che non deve
 * esistere. Vedi lib/fatturazione/emissione.ts.
 *
 * Famiglie di classi riprese da `StatusChip` (components/ui/status-chip.tsx):
 * pv-amber-50/500 (PROCESSATA), pv-green-50/500 (FIRMATA), pv-slate-100/700
 * (BOZZA) sono le uniche coppie bg/text di queste famiglie definite in
 * globals.css — non esistono pv-amber-100/800, pv-green-100/800 né
 * pv-slate-600.
 */
const STYLE: Record<ReturnType<typeof statoEmissione>, string> = {
  DA_EMETTERE: 'bg-pv-amber-50 text-pv-amber-500',
  EMESSA: 'bg-pv-green-50 text-pv-green-500',
  FUORI_SDI: 'bg-pv-slate-100 text-pv-slate-700',
};

export function StatoEmissioneChip({
  doc,
  className,
}: {
  doc: { fatturaPaTipo: FatturaPaTipo | null; trasmessoSdiAt: Date | null };
  className?: string;
}) {
  const stato = statoEmissione(doc);
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider',
        STYLE[stato],
        className,
      )}
    >
      {labelEmissione(stato)}
    </span>
  );
}
