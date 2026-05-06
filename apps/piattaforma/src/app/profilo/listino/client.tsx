'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card } from '@/components/ui';
import {
  saveListinoFormAction,
  uploadListinoFileAction,
  deleteListinoAction,
} from './actions';

type Initial = {
  formato: string;
  prezzoBaseTrapassoEuro: number;
  prezzoMinivolturaEuro: number;
  pre2015MaggiorazionEuro: number;
  lottoMassivoMaggiorazionEuro: number;
  provincieCopertura: string;
  hasUpload: boolean;
} | null;

export function ListinoClient({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [mode, setMode] = useState<'form' | 'upload'>(
    initial?.formato === 'UPLOAD_FILE' ? 'upload' : 'form',
  );
  const [data, setData] = useState({
    prezzoBaseTrapassoEuro: initial?.prezzoBaseTrapassoEuro ?? 25,
    prezzoMinivolturaEuro: initial?.prezzoMinivolturaEuro ?? 15,
    pre2015MaggiorazionEuro: initial?.pre2015MaggiorazionEuro ?? 0,
    lottoMassivoMaggiorazionEuro: initial?.lottoMassivoMaggiorazionEuro ?? 0,
    provincieCopertura: initial?.provincieCopertura ?? '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [provincieUpload, setProvincieUpload] = useState(
    initial?.provincieCopertura ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submitForm = (): void => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await saveListinoFormAction(data);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess('Listino salvato con successo.');
      router.refresh();
    });
  };

  const submitUpload = (): void => {
    setError(null);
    setSuccess(null);
    if (!file) {
      setError('Seleziona un file.');
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('provincieCopertura', provincieUpload);
      const res = await uploadListinoFileAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSuccess('Listino caricato con successo.');
      setFile(null);
      router.refresh();
    });
  };

  const submitDelete = (): void => {
    if (!confirm('Eliminare il listino pubblicato?')) return;
    startTransition(async () => {
      const res = await deleteListinoAction();
      if (res.ok) {
        setSuccess('Listino rimosso.');
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <Card>
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode('form')}
          className={
            'rounded-[10px] px-3 py-1.5 text-[12.5px] font-semibold ' +
            (mode === 'form'
              ? 'bg-pv-navy-700 text-white'
              : 'bg-pv-slate-100 text-pv-slate-700 hover:bg-pv-slate-200')
          }
        >
          Form strutturato
        </button>
        <button
          type="button"
          onClick={() => setMode('upload')}
          className={
            'rounded-[10px] px-3 py-1.5 text-[12.5px] font-semibold ' +
            (mode === 'upload'
              ? 'bg-pv-navy-700 text-white'
              : 'bg-pv-slate-100 text-pv-slate-700 hover:bg-pv-slate-200')
          }
        >
          Upload PDF/JPG
        </button>
      </div>

      {mode === 'form' && (
        <div className="space-y-3">
          <p className="text-[12.5px] text-pv-slate-500">
            Inserisci i prezzi base. Le maggiorazioni sono opzionali e
            specifiche del tuo listino. Tutti i prezzi sono in euro.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Trapasso netto base (€) *"
              value={data.prezzoBaseTrapassoEuro}
              type="number"
              step="0.50"
              onChange={(v) =>
                setData({ ...data, prezzoBaseTrapassoEuro: Number(v) })
              }
            />
            <Field
              label="Minivoltura base (€) *"
              value={data.prezzoMinivolturaEuro}
              type="number"
              step="0.50"
              onChange={(v) =>
                setData({ ...data, prezzoMinivolturaEuro: Number(v) })
              }
            />
            <Field
              label="Maggiorazione pre-2015 (€)"
              value={data.pre2015MaggiorazionEuro}
              type="number"
              step="0.50"
              onChange={(v) =>
                setData({ ...data, pre2015MaggiorazionEuro: Number(v) })
              }
            />
            <Field
              label="Sconto lotto massivo (€, neg.)"
              value={data.lottoMassivoMaggiorazionEuro}
              type="number"
              step="0.50"
              onChange={(v) =>
                setData({
                  ...data,
                  lottoMassivoMaggiorazionEuro: Number(v),
                })
              }
            />
          </div>
          <Field
            label="Province coperte (sigle separate da virgola, es. PD, VE, TV) *"
            value={data.provincieCopertura}
            onChange={(v) => setData({ ...data, provincieCopertura: v })}
            placeholder="PD, VE, TV"
          />
          {error && (
            <Alert variant="error">{error}</Alert>
          )}
          {success && (
            <Alert variant="success">{success}</Alert>
          )}
          <div className="flex gap-2">
            <Button onClick={submitForm} disabled={pending} loading={pending}>
              Salva listino
            </Button>
            {initial && (
              <Button
                variant="danger"
                size="sm"
                onClick={submitDelete}
                disabled={pending}
              >
                Elimina listino
              </Button>
            )}
          </div>
        </div>
      )}

      {mode === 'upload' && (
        <div className="space-y-3">
          <p className="text-[12.5px] text-pv-slate-500">
            Se preferisci caricare il tuo listino in formato PDF/immagine,
            puoi farlo qui. La piattaforma mostrerà il file ai broker che
            chiedono il preventivo.
          </p>
          {initial?.hasUpload && (
            <p className="rounded-[8px] bg-pv-green-50 px-3 py-2 text-[12.5px] text-pv-green-500">
              ✓ Hai già un listino caricato. Carica un nuovo file per
              sostituirlo.
            </p>
          )}
          <Field
            label="Province coperte (sigle separate da virgola) *"
            value={provincieUpload}
            onChange={setProvincieUpload}
            placeholder="PD, VE, TV"
          />
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              File listino (PDF/JPG/PNG, max 10 MB)
            </span>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-[12.5px]"
            />
          </label>
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}
          <div className="flex gap-2">
            <Button
              onClick={submitUpload}
              disabled={pending || !file}
              loading={pending}
            >
              Carica listino
            </Button>
            {initial && (
              <Button
                variant="danger"
                size="sm"
                onClick={submitDelete}
                disabled={pending}
              >
                Elimina listino
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function Field({
  label,
  value,
  type = 'text',
  step,
  onChange,
  placeholder,
}: {
  label: string;
  value: string | number;
  type?: string;
  step?: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
        {label}
      </span>
      <input
        type={type}
        value={value}
        step={step}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
      />
    </label>
  );
}
