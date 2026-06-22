'use client';

import { useState, useTransition } from 'react';
import type { AtecoAllowedCode, CompanyType } from '@pv/db';
import { Alert, Button, Field, Input, Select } from '@/components/ui';
import { createAtecoAction, toggleAtecoAction } from './actions';

export function AtecoClient({ codes }: { codes: AtecoAllowedCode[] }) {
  const [companyType, setCompanyType] = useState<CompanyType>('DEALER');
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const create = () => {
    setError(null);
    startTransition(async () => {
      const r = await createAtecoAction({ companyType, code, label: label || undefined });
      if (!r.ok) setError(r.error);
      else {
        setCode('');
        setLabel('');
      }
    });
  };

  const toggle = (id: string, active: boolean) => {
    startTransition(async () => {
      await toggleAtecoAction(id, active);
    });
  };

  return (
    <div className="mt-6 space-y-8">
      <div className="rounded-xl border border-pv-slate-200 bg-white p-5">
        <h2 className="text-[16px] font-bold text-pv-navy-900">Nuovo codice ATECO</h2>
        {error && <Alert variant="error" className="mt-3">{error}</Alert>}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Tipo azienda" required>
            <Select value={companyType} onChange={(e) => setCompanyType(e.target.value as CompanyType)}>
              <option value="DEALER">Broker</option>
              <option value="AGENZIA">Agenzia</option>
            </Select>
          </Field>
          <Field label="Codice" required hint="Senza punti, es. 4511">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="4511" />
          </Field>
          <Field label="Descrizione" hint="Opzionale">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Commercio autoveicoli" />
          </Field>
        </div>
        <Button type="button" onClick={create} loading={pending} className="mt-4">
          Aggiungi codice
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-pv-slate-200 bg-white">
        <table className="w-full text-[13px]">
          <thead className="bg-pv-slate-50 text-pv-slate-500">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Tipo azienda</th>
              <th className="px-4 py-2 text-left font-semibold">Codice</th>
              <th className="px-4 py-2 text-left font-semibold">Descrizione</th>
              <th className="px-4 py-2 text-left font-semibold">Stato</th>
              <th className="px-4 py-2 text-right font-semibold">Azione</th>
            </tr>
          </thead>
          <tbody>
            {codes.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-pv-slate-500">Nessun codice ATECO configurato.</td></tr>
            )}
            {codes.map((c) => (
              <tr key={c.id} className="border-t border-pv-slate-100">
                <td className="px-4 py-2 font-semibold text-pv-navy-900">
                  {c.companyType === 'DEALER' ? 'Broker' : 'Agenzia'}
                </td>
                <td className="px-4 py-2 font-semibold text-pv-navy-900">{c.code}</td>
                <td className="px-4 py-2">{c.label ?? '—'}</td>
                <td className="px-4 py-2">{c.active ? 'Attivo' : 'Disattivato'}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => toggle(c.id, !c.active)}
                    disabled={pending}
                    className="font-semibold text-pv-navy-600 hover:underline"
                  >
                    {c.active ? 'Disattiva' : 'Riattiva'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
