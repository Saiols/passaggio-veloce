'use client';

import { useState } from 'react';
import { Alert, Button, Card, Input } from '@/components/ui';
import { parseYmd } from '@/lib/date/rome-day';
import type { Festivo } from '@/lib/distribuzione/calendario';
import { serveAggiornareFestivi } from './festivi-avviso';

/** "2026-12-25" → "25/12/2026". */
function formatData(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Giorni di chiusura della piattaforma. Sono date piene, non ricorrenze: le
 * passate restano visibili in grigio, perché nasconderle darebbe l'impressione
 * che la lista si sia svuotata.
 */
export function FestiviEditor({
  value,
  onChange,
  oggiIso,
}: {
  value: Festivo[];
  onChange: (v: Festivo[]) => void;
  oggiIso: string;
}) {
  const [data, setData] = useState('');
  const [nome, setNome] = useState('');

  const aggiungi = (): void => {
    const nomeTrim = nome.trim();
    if (!parseYmd(data) || !nomeTrim) return;
    if (value.some((f) => f.data === data)) return;
    onChange(
      [...value, { data, nome: nomeTrim.slice(0, 60) }].sort((a, b) => a.data.localeCompare(b.data)),
    );
    setData('');
    setNome('');
  };

  // `oggiIso` arriva dal server (giorno di Roma): costruire l'orario a
  // mezzogiorno UTC evita che il fuso del browser sposti la data di un giorno.
  const avviso = serveAggiornareFestivi(value, new Date(`${oggiIso}T12:00:00Z`));

  return (
    <Card>
      <h2 className="text-[15px] font-bold text-pv-navy-800">Festivi</h2>
      <p className="mt-1 text-[13px] text-pv-slate-500">
        Giorni in cui il raggio non si allarga, anche se il giorno della settimana è
        attivo. Il primo round parte comunque.
      </p>

      {avviso && (
        <div className="mt-3">
          <Alert variant="warning" title="Calendario da aggiornare">
            Nessun festivo configurato nei prossimi due mesi. Sono date piene, non
            ricorrenze: senza aggiungere quelle dell&apos;anno prossimo, la distribuzione
            si allargherà normalmente anche a Natale.
          </Alert>
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {value.map((f) => (
          <li
            key={f.data}
            className="flex items-center justify-between gap-3 rounded-[10px] border border-pv-slate-200 px-3 py-2"
          >
            <span
              className={
                f.data < oggiIso ? 'text-[13px] text-pv-slate-400' : 'text-[13px] text-pv-navy-800'
              }
            >
              <strong>{formatData(f.data)}</strong> · {f.nome}
              {f.data < oggiIso && ' (passato)'}
            </span>
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x.data !== f.data))}
              className="shrink-0 text-[12px] font-bold uppercase tracking-wider text-pv-slate-500 hover:text-pv-navy-800"
            >
              Rimuovi
            </button>
          </li>
        ))}
        {value.length === 0 && (
          <li className="text-[13px] text-pv-slate-500">Nessun festivo configurato.</li>
        )}
      </ul>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Input
          type="date"
          value={data}
          onChange={(e) => setData(e.currentTarget.value)}
          aria-label="Data del festivo"
          className="w-[170px]"
        />
        <Input
          value={nome}
          onChange={(e) => setNome(e.currentTarget.value)}
          placeholder="Nome (es. Ferragosto)"
          aria-label="Nome del festivo"
          className="w-[220px]"
        />
        <Button type="button" variant="secondary" onClick={aggiungi}>
          Aggiungi
        </Button>
      </div>
    </Card>
  );
}
