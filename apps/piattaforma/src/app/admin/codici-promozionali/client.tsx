'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Field, Input, NumberInput } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { formatCurrencyCent, formatDate } from '@/lib/format';
import { createPromoCodeAction, togglePromoCodeAction } from './actions';

type Row = {
  id: string; code: string; amountCent: number; expiresAt: string | null;
  maxRedemptions: number | null; active: boolean; redemptions: number;
};

function stato(r: Row): string {
  if (!r.active) return 'Disattivato';
  if (r.expiresAt && new Date(r.expiresAt).getTime() < Date.now()) return 'Scaduto';
  if (r.maxRedemptions != null && r.redemptions >= r.maxRedemptions) return 'Esaurito';
  return 'Attivo';
}

export function PromoCodiClient({ rows }: { rows: Row[] }) {
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [expires, setExpires] = useState('');
  const [maxR, setMaxR] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const create = () => {
    setError(null);
    startTransition(async () => {
      const r = await createPromoCodeAction({
        code,
        amountEuro: amount ?? 0,
        expiresAt: expires || null,
        maxRedemptions: maxR,
      });
      if (!r.ok) setError(r.error);
      else {
        setCode(''); setAmount(null); setExpires(''); setMaxR(null);
      }
    });
  };

  const toggle = (id: string, active: boolean) => {
    startTransition(async () => {
      await togglePromoCodeAction(id, active);
    });
  };

  return (
    <div className="mt-6 space-y-8">
      <div className="rounded-xl border border-pv-slate-200 bg-white p-5">
        <h2 className="text-[16px] font-bold text-pv-navy-900">Nuovo codice</h2>
        {error && <Alert variant="error" className="mt-3">{error}</Alert>}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Codice" required>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="BENVENUTO" />
          </Field>
          <Field label="Importo (€)" required>
            <NumberInput min={0} step="0.01" value={amount} onChange={setAmount} />
          </Field>
          <Field label="Scadenza" hint="Opzionale">
            <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
          <Field label="Max riscatti" hint="Opzionale">
            <NumberInput min={1} step={1} integer allowEmpty value={maxR} onChange={setMaxR} />
          </Field>
        </div>
        <Button type="button" onClick={create} loading={pending} className="mt-4">
          Crea codice
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-pv-slate-200 bg-white">
        <table className="w-full text-[13px]">
          <thead className="bg-pv-slate-50 text-pv-slate-500">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Codice</th>
              <th className="px-4 py-2 text-left font-semibold">Importo</th>
              <th className="px-4 py-2 text-left font-semibold">Scadenza</th>
              <th className="px-4 py-2 text-left font-semibold">Riscatti</th>
              <th className="px-4 py-2 text-left font-semibold">Stato</th>
              <th className="px-4 py-2 text-right font-semibold">Azione</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-pv-slate-500">Nessun codice creato.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-pv-slate-100">
                <td className="px-4 py-2 font-semibold text-pv-navy-900">{r.code}</td>
                <td className="px-4 py-2">{formatCurrencyCent(r.amountCent)}</td>
                <td className="px-4 py-2">{r.expiresAt ? formatDate(new Date(r.expiresAt)) : '—'}</td>
                <td className="px-4 py-2">{r.redemptions}{r.maxRedemptions != null ? ` / ${r.maxRedemptions}` : ''}</td>
                <td className="px-4 py-2">{stato(r)}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => toggle(r.id, !r.active)}
                    disabled={pending}
                    className="font-semibold text-pv-navy-600 hover:underline"
                  >
                    {r.active ? 'Disattiva' : 'Riattiva'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LoadingOverlay show={pending} label="Salvataggio…" />
    </div>
  );
}
