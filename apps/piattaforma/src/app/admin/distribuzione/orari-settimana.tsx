'use client';

import { Card, Checkbox, Input } from '@/components/ui';
import { GIORNI_ORDINE, type FasciaGiorno } from '@/lib/distribuzione/calendario';
import type { GiornoSettimana } from '@/lib/distribuzione/ore-lavorative';

const GIORNI_LABEL: Record<GiornoSettimana, string> = {
  LUN: 'Lunedì',
  MAR: 'Martedì',
  MER: 'Mercoledì',
  GIO: 'Giovedì',
  VEN: 'Venerdì',
  SAB: 'Sabato',
  DOM: 'Domenica',
};

type Orari = Record<GiornoSettimana, FasciaGiorno>;

/**
 * Finestra di apertura giorno per giorno. Un giorno spento tiene comunque i suoi
 * orari (restano modificabili): riattivarlo non deve costringere a ridigitarli.
 */
export function OrariSettimanaEditor({
  value,
  onChange,
  errore,
}: {
  value: Orari;
  onChange: (v: Orari) => void;
  errore?: string;
}) {
  const set = (g: GiornoSettimana, patch: Partial<FasciaGiorno>): void => {
    onChange({ ...value, [g]: { ...value[g], ...patch } });
  };

  return (
    <Card>
      <h2 className="text-[15px] font-bold text-pv-navy-800">Giorni e orari</h2>
      <p className="mt-1 text-[13px] text-pv-slate-500">
        Quando il motore può allargare il raggio. Fuori da questa finestra parte solo il
        primo round: l&apos;espansione riprende alla successiva apertura. Gli orari
        dichiarati dalle agenzie non hanno effetto sulla distribuzione.
      </p>

      <ul className="mt-4 space-y-2">
        {GIORNI_ORDINE.map((g) => (
          <li
            key={g}
            className="flex flex-wrap items-center gap-3 rounded-[10px] border border-pv-slate-200 px-3 py-2"
          >
            <label className="flex min-w-[130px] items-center gap-2 text-[13px] font-semibold text-pv-navy-800">
              <Checkbox
                checked={value[g].attivo}
                onChange={(e) => set(g, { attivo: e.currentTarget.checked })}
                aria-label={`${GIORNI_LABEL[g]} attivo`}
              />
              {GIORNI_LABEL[g]}
            </label>

            <div className="flex items-center gap-2 text-[13px] text-pv-slate-500">
              <span>dalle</span>
              <Input
                type="time"
                value={value[g].inizio}
                onChange={(e) => set(g, { inizio: e.currentTarget.value })}
                aria-label={`${GIORNI_LABEL[g]} dalle`}
                className="w-[110px]"
              />
              <span>alle</span>
              <Input
                type="time"
                value={value[g].fine}
                onChange={(e) => set(g, { fine: e.currentTarget.value })}
                aria-label={`${GIORNI_LABEL[g]} alle`}
                className="w-[110px]"
              />
            </div>

            {!value[g].attivo && (
              <span className="text-[12px] text-pv-slate-500">chiuso</span>
            )}
          </li>
        ))}
      </ul>

      {errore && <p className="mt-3 text-xs font-medium text-pv-red-500">{errore}</p>}
    </Card>
  );
}
