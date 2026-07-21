import type { PraticaStato as DbPraticaStato } from '@pv/db';
import { cn } from './cn';

/**
 * Derivato da `@pv/db` (Prisma) invece di ridichiarato a mano: prima questo
 * modulo teneva una propria union di 10 literal, scollegata dall'enum reale.
 * Quando l'enum è cresciuto a 11 valori con `IN_DISTRIBUZIONE` (distribuzione
 * v2), i chiamanti passavano comunque `p.stato as PraticaStato` (un cast, non
 * un controllo) e `styles['IN_DISTRIBUZIONE']` era `undefined` → crash su
 * `.cls`. Derivando il tipo da `@pv/db`, `Record<PraticaStato, …>` sotto
 * costringe il compilatore a richiedere una voce per OGNI valore dell'enum: il
 * prossimo stato mancante è un errore di build, non un crash a runtime.
 */
export type PraticaStato = DbPraticaStato;

/**
 * Lo stesso PraticaStato del DB viene mostrato con label diverse a seconda del
 * viewer (item 02 release 2026-05): broker e agenzia non devono vedere il
 * numero di round o la parola "escalation". Solo l'admin platform vede tutto.
 */
export type ChipViewerRole = 'BROKER' | 'AGENZIA' | 'ADMIN' | 'GENERIC';

/**
 * Chip neutro di fallback: usato SOLO se `stato` non è una chiave di `styles`
 * (dato malformato / valore dell'enum aggiunto senza aggiornare questo file —
 * scenario che `Record<PraticaStato, …>` dovrebbe già impedire a compile-time,
 * ma un `any`/cast a monte può comunque portare qui un valore ignoto). Degrada
 * a un badge grigio invece di lanciare un TypeError su `undefined.cls`.
 */
const NEUTRAL_FALLBACK = { cls: 'bg-pv-slate-100 text-pv-slate-500' };

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
  // Motore v2: sostituisce il ciclo ROUND_1→R3, stesso gruppo "in distribuzione"
  // (vedi lib/pratiche/stati.ts). Token pv-* con modificatore di opacità
  // (nessun colore hardcoded), stesso pattern già in uso altrove nel repo.
  IN_DISTRIBUZIONE: { cls: 'bg-pv-orange-500/12 text-pv-orange-500' },
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
  IN_DISTRIBUZIONE: 'In distribuzione',
  ACCETTATA: 'Accettata',
  PROCESSATA: 'Processata',
  FIRMATA: 'Firmata',
  SCADUTA: 'Scaduta',
  ANNULLATA: 'Annullata',
};

function labelFor(stato: PraticaStato, role: ChipViewerRole): string {
  if (role === 'ADMIN' || role === 'GENERIC') return ADMIN_LABELS[stato] ?? 'Sconosciuto';
  // Broker e agenzia: niente numero round, niente parola "escalation". Il
  // motore v2 (IN_DISTRIBUZIONE) è lo stesso concetto dei round legacy dal
  // loro punto di vista: "in attesa che un'agenzia accetti".
  if (
    stato === 'IN_ATTESA_ROUND_1' ||
    stato === 'IN_ATTESA_ROUND_2' ||
    stato === 'IN_ATTESA_ROUND_3' ||
    stato === 'IN_DISTRIBUZIONE'
  ) {
    return 'In attesa';
  }
  if (stato === 'IN_ESCALATION') {
    return role === 'BROKER' ? 'In gestione' : 'In gestione team';
  }
  return ADMIN_LABELS[stato] ?? 'Sconosciuto';
}

export function StatusChip({
  stato,
  viewerRole = 'GENERIC',
  tone,
  className,
}: {
  stato: PraticaStato;
  viewerRole?: ChipViewerRole;
  /** Sovrascrive la palette dello stato (es. ANNULLATA da team → rosso). */
  tone?: 'danger';
  className?: string;
}) {
  // Difensivo: `styles[stato]` può risultare `undefined` se un chiamante ha
  // forzato un valore con un cast (`as PraticaStato`) che non corrisponde a
  // nessuna chiave reale — il caso che ha causato il crash originale con
  // IN_DISTRIBUZIONE prima di questo fix. Degrada a neutro invece di lanciare.
  const s = styles[stato] ?? NEUTRAL_FALLBACK;
  const cls = tone === 'danger' ? 'bg-pv-red-50 text-pv-red-500' : s.cls;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider',
        cls,
        className,
      )}
    >
      {labelFor(stato, viewerRole)}
    </span>
  );
}
