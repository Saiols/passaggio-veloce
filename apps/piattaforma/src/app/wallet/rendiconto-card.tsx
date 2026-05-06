'use client';

import { useState } from 'react';

const MONTHS = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

/**
 * Card con picker mese/anno e download del rendiconto PDF (AF-PDF).
 * Default sul mese precedente (più sensato come "rendiconto chiuso").
 */
export function RendicontoCard({ minYear }: { minYear: number }) {
  const now = new Date();
  // Default: mese precedente
  const defaultMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const defaultYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);

  const years = Array.from(
    { length: now.getFullYear() - minYear + 1 },
    (_, i) => minYear + i,
  );

  const href = `/api/wallet/rendiconto?year=${year}&month=${month}`;

  return (
    <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
      <h2 className="text-[15px] font-bold text-pv-navy-800">
        📄 Rendiconto PDF mensile
      </h2>
      <p className="mt-1 text-[12.5px] text-pv-slate-500">
        Scarica il rendiconto separato per crediti pratiche e crediti affiliazione.
        Conserva ai fini fiscali.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Mese
          </span>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="mt-1 rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
          >
            {MONTHS.map((m, i) => (
              <option key={i + 1} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Anno
          </span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="mt-1 rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <a
          href={href}
          download
          className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-pv-navy-800"
        >
          Scarica PDF
        </a>
      </div>
    </div>
  );
}
