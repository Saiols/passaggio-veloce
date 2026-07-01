'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingOverlay } from '@/components/ui/loading-overlay';

const jobs = [
  { key: 'fee', label: '⚡ Processa addebiti SCHEDULED', endpoint: '/api/jobs/process-fee-scheduled' },
  { key: 'payouts', label: '💰 Processa payout pendenti', endpoint: '/api/jobs/process-payouts' },
  { key: 'tick', label: '🔁 Avanza tick distribuzione', endpoint: '/api/jobs/distribuzione-tick' },
  { key: 'solleciti', label: '📨 Invia solleciti pratiche', endpoint: '/api/jobs/send-solleciti' },
  { key: 'autoPayout', label: '🎯 Trigger payout automatici', endpoint: '/api/jobs/trigger-auto-payout' },
  { key: 'crmSync', label: '🔄 Sync CRM ↔ piattaforma', endpoint: '/api/jobs/crm-sync' },
  { key: 'monthlyRecap', label: '📊 Recap mensile affiliazione (N25)', endpoint: '/api/jobs/affiliation-monthly-recap' },
];

type JobState = { running: boolean; result?: string; error?: string };

export function JobButtons() {
  const [state, setState] = useState<Record<string, JobState>>({});
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(key: string, endpoint: string) {
    setState((s) => ({ ...s, [key]: { running: true } }));
    startTransition(async () => {
      try {
        const res = await fetch(endpoint, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
          setState((s) => ({ ...s, [key]: { running: false, error: data.error ?? 'Errore' } }));
          return;
        }
        const summary = Object.entries(data)
          .filter(([k]) => k !== 'ok')
          .map(([k, v]) => `${k}: ${v}`)
          .join(' · ');
        setState((s) => ({ ...s, [key]: { running: false, result: summary } }));
        router.refresh();
      } catch (err) {
        setState((s) => ({ ...s, [key]: { running: false, error: String(err) } }));
      }
    });
  }

  return (
    <div className="rounded-2xl border border-pv-slate-200 bg-white p-5">
      <h2 className="text-base font-bold text-pv-navy-900 mb-3">Esegui job</h2>
      <div className="space-y-2">
        {jobs.map((j) => {
          const s = state[j.key];
          return (
            <div key={j.key} className="flex items-center justify-between gap-3 rounded-lg border border-pv-slate-200 bg-pv-slate-50 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-pv-navy-900">{j.label}</p>
                {s?.result && <p className="text-xs text-pv-green-500">{s.result}</p>}
                {s?.error && <p className="text-xs text-pv-red-500">{s.error}</p>}
              </div>
              <button
                type="button"
                onClick={() => run(j.key, j.endpoint)}
                disabled={pending || s?.running}
                className="shrink-0 rounded-lg bg-pv-navy-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {s?.running ? 'Esecuzione…' : 'Esegui'}
              </button>
            </div>
          );
        })}
      </div>
      <LoadingOverlay show={pending} label="Esecuzione job…" />
    </div>
  );
}
