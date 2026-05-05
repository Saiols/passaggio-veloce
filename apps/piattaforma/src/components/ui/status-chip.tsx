import { cn } from './cn';

export type PraticaStato =
  | 'BOZZA'
  | 'IN_ATTESA_ROUND_1'
  | 'IN_ATTESA_ROUND_2'
  | 'IN_ATTESA_ROUND_3'
  | 'IN_ESCALATION'
  | 'ACCETTATA'
  | 'PROCESSATA'
  | 'FIRMATA'
  | 'SCADUTA'
  | 'ANNULLATA';

/**
 * Lo stesso PraticaStato del DB viene mostrato con label diverse a seconda del
 * viewer (item 02 release 2026-05): broker e agenzia non devono vedere il
 * numero di round o la parola "escalation". Solo l'admin platform vede tutto.
 */
export type ChipViewerRole = 'BROKER' | 'AGENZIA' | 'ADMIN' | 'GENERIC';

const styles: Record<PraticaStato, { cls: string }> = {
  BOZZA: { cls: 'bg-pv-slate-100 text-pv-slate-700' },
  IN_ATTESA_ROUND_1: {
    cls: 'bg-[color-mix(in_srgb,#ff7a00_18%,white)] text-pv-orange-500',
  },
  IN_ATTESA_ROUND_2: {
    cls: 'bg-[color-mix(in_srgb,#ff7a00_25%,white)] text-pv-orange-500',
  },
  IN_ATTESA_ROUND_3: {
    cls: 'bg-[color-mix(in_srgb,#ff7a00_32%,white)] text-pv-orange-500',
  },
  IN_ESCALATION: { cls: 'bg-pv-red-50 text-pv-red-500' },
  ACCETTATA: { cls: 'bg-pv-navy-100 text-pv-navy-700' },
  PROCESSATA: { cls: 'bg-pv-amber-50 text-pv-amber-500' },
  FIRMATA: { cls: 'bg-pv-green-50 text-pv-green-500' },
  SCADUTA: { cls: 'bg-pv-red-50 text-pv-red-500' },
  ANNULLATA: { cls: 'bg-pv-slate-100 text-pv-slate-500' },
};

const ADMIN_LABELS: Record<PraticaStato, string> = {
  BOZZA: 'Bozza',
  IN_ATTESA_ROUND_1: 'In attesa · R1',
  IN_ATTESA_ROUND_2: 'In attesa · R2',
  IN_ATTESA_ROUND_3: 'In attesa · R3',
  IN_ESCALATION: 'Escalation',
  ACCETTATA: 'Accettata',
  PROCESSATA: 'Processata',
  FIRMATA: 'Firmata',
  SCADUTA: 'Scaduta',
  ANNULLATA: 'Annullata',
};

function labelFor(stato: PraticaStato, role: ChipViewerRole): string {
  if (role === 'ADMIN' || role === 'GENERIC') return ADMIN_LABELS[stato];
  // Broker e agenzia: niente numero round, niente parola "escalation".
  if (
    stato === 'IN_ATTESA_ROUND_1' ||
    stato === 'IN_ATTESA_ROUND_2' ||
    stato === 'IN_ATTESA_ROUND_3'
  ) {
    return 'In attesa';
  }
  if (stato === 'IN_ESCALATION') {
    return role === 'BROKER' ? 'In gestione' : 'In gestione team';
  }
  return ADMIN_LABELS[stato];
}

export function StatusChip({
  stato,
  viewerRole = 'GENERIC',
  className,
}: {
  stato: PraticaStato;
  viewerRole?: ChipViewerRole;
  className?: string;
}) {
  const s = styles[stato];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider',
        s.cls,
        className,
      )}
    >
      {labelFor(stato, viewerRole)}
    </span>
  );
}
