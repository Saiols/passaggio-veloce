'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Input, Modal, Select } from '@/components/ui';
import { SedeCreateForm } from './sede-create-form';

export type SedeRow = {
  id: string;
  nome: string;
  citta: string;
  provincia: string;
  iban: string | null;
  referralCode: string | null;
  suspendedAt: string | null;
};

type StatoFilter = 'tutte' | 'attive' | 'sospese';

export function SediClient({ sedi }: { sedi: SedeRow[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [stato, setStato] = useState<StatoFilter>('tutte');

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return sedi.filter((s) => {
      if (stato === 'attive' && s.suspendedAt) return false;
      if (stato === 'sospese' && !s.suspendedAt) return false;
      if (term && !(s.nome.toLowerCase().includes(term) || s.citta.toLowerCase().includes(term))) {
        return false;
      }
      return true;
    });
  }, [sedi, q, stato]);

  return (
    <>
      {/* Barra: filtri a sinistra, "Aggiungi" in alto a destra */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cerca per nome o città…"
            className="sm:max-w-xs"
          />
          <Select
            value={stato}
            onChange={(e) => setStato(e.target.value as StatoFilter)}
            className="sm:w-[160px]"
          >
            <option value="tutte">Tutte</option>
            <option value="attive">Attive</option>
            <option value="sospese">Sospese</option>
          </Select>
        </div>
        <Button size="md" onClick={() => setOpen(true)} className="sm:self-end">
          + Aggiungi sede
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-pv-slate-200 bg-white">
        <div className="border-b border-pv-slate-200 bg-pv-slate-50 px-5 py-2.5">
          <p className="text-[12px] font-bold uppercase tracking-wider text-pv-slate-600">
            {filtered.length} {filtered.length === 1 ? 'sede' : 'sedi'}
          </p>
        </div>
        {filtered.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-pv-slate-500">
            Nessuna sede corrisponde ai filtri.
          </p>
        ) : (
          <ul className="divide-y divide-pv-slate-100">
            {filtered.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sedi/${s.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-pv-slate-50"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-pv-navy-900">
                      {s.nome}
                      {s.suspendedAt && (
                        <span className="ml-2 rounded-full bg-pv-red-500/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-pv-red-600">
                          Sospesa
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-pv-slate-500">
                      {s.citta} ({s.provincia}) · {s.iban ? 'IBAN dedicato' : 'IBAN madre'}
                    </p>
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold text-pv-navy-600">
                    Dettaglio →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Aggiungi una sede"
        description="Definisci una nuova sede operativa sotto la tua azienda."
      >
        <SedeCreateForm onSuccess={() => setOpen(false)} />
      </Modal>
    </>
  );
}
