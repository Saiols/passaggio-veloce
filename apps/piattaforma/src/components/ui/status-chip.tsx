import { cn } from './cn';

export type PraticaStato =
  | 'BOZZA'
  | 'IN_ATTESA_ROUND_1'
  | 'IN_ATTESA_ROUND_2'
  | 'IN_ATTESA_ROUND_3'
  | 'IN_ESCALATION'
  | 'ACCETTATA'
  | 'FIRMATA'
  | 'SCADUTA'
  | 'ANNULLATA';

const styles: Record<PraticaStato, { label: string; cls: string }> = {
  BOZZA: {
    label: 'Bozza',
    cls: 'bg-pv-slate-100 text-pv-slate-700',
  },
  IN_ATTESA_ROUND_1: {
    label: 'In attesa · R1',
    cls: 'bg-[color-mix(in_srgb,#ff7a00_18%,white)] text-pv-orange-500',
  },
  IN_ATTESA_ROUND_2: {
    label: 'In attesa · R2',
    cls: 'bg-[color-mix(in_srgb,#ff7a00_25%,white)] text-pv-orange-500',
  },
  IN_ATTESA_ROUND_3: {
    label: 'In attesa · R3',
    cls: 'bg-[color-mix(in_srgb,#ff7a00_32%,white)] text-pv-orange-500',
  },
  IN_ESCALATION: {
    label: 'Escalation',
    cls: 'bg-pv-red-50 text-pv-red-500',
  },
  ACCETTATA: {
    label: 'Accettata',
    cls: 'bg-pv-navy-100 text-pv-navy-700',
  },
  FIRMATA: {
    label: 'Firmata',
    cls: 'bg-pv-green-50 text-pv-green-500',
  },
  SCADUTA: {
    label: 'Scaduta',
    cls: 'bg-pv-red-50 text-pv-red-500',
  },
  ANNULLATA: {
    label: 'Annullata',
    cls: 'bg-pv-slate-100 text-pv-slate-500',
  },
};

export function StatusChip({ stato, className }: { stato: PraticaStato; className?: string }) {
  const s = styles[stato];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider',
        s.cls,
        className,
      )}
    >
      {s.label}
    </span>
  );
}
