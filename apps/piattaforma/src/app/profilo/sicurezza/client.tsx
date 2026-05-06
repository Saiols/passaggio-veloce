'use client';

import { useState, useTransition } from 'react';
import QRCode from 'qrcode';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@/components/ui';
import {
  start2faSetupAction,
  confirm2faSetupAction,
  disable2faAction,
} from './actions';

type Stage = 'idle' | 'setup' | 'showBackupCodes' | 'disable';

export function SicurezzaClient({
  email,
  enabled,
}: {
  email: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('idle');
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const start = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await start2faSetupAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSetup(res.setup);
      const dataUrl = await QRCode.toDataURL(res.setup.uri, {
        margin: 1,
        width: 220,
        color: { dark: '#0a2540', light: '#ffffff' },
      });
      setQrDataUrl(dataUrl);
      setStage('setup');
    });
  };

  const confirm = (): void => {
    setError(null);
    if (!setup) return;
    startTransition(async () => {
      const res = await confirm2faSetupAction(setup.secret, code);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBackupCodes(res.backupCodes);
      setStage('showBackupCodes');
      router.refresh();
    });
  };

  const disable = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await disable2faAction(password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPassword('');
      setStage('idle');
      router.refresh();
    });
  };

  if (enabled && stage === 'idle') {
    return (
      <div className="space-y-3">
        <div className="rounded-[10px] bg-pv-green-50 px-3 py-2 text-[13px] text-pv-green-500">
          ✓ <strong>2FA attivo</strong>. Al prossimo login ti verrà chiesto il
          codice dell&apos;app authenticator.
        </div>
        <p className="text-[12.5px] text-pv-slate-500">
          Per disattivare il 2FA conferma con la tua password.
        </p>
        <Button variant="danger" size="sm" onClick={() => setStage('disable')}>
          Disattiva 2FA
        </Button>
      </div>
    );
  }

  if (stage === 'disable') {
    return (
      <div className="space-y-3">
        <Alert variant="warning">
          Disattivare il 2FA riduce la sicurezza dell&apos;account.
        </Alert>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            La tua password
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
          />
        </label>
        {error && <Alert variant="error">{error}</Alert>}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setStage('idle')}
            disabled={pending}
          >
            Annulla
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={disable}
            disabled={pending || !password}
            loading={pending}
          >
            Disattiva 2FA
          </Button>
        </div>
      </div>
    );
  }

  if (stage === 'setup' && setup && qrDataUrl) {
    return (
      <div className="space-y-3">
        <ol className="list-decimal pl-5 text-[13px] text-pv-slate-700 space-y-1">
          <li>Apri la tua app authenticator e scansiona il QR.</li>
          <li>Se non puoi scansionare, inserisci manualmente il secret qui sotto.</li>
          <li>Inserisci il codice a 6 cifre per confermare l&apos;attivazione.</li>
        </ol>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt="QR code 2FA"
            width={220}
            height={220}
            className="rounded-[10px] border border-pv-slate-200 bg-white p-2"
          />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Account
            </p>
            <p className="text-[13px] text-pv-navy-900">{email}</p>
            <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Secret manuale
            </p>
            <code className="mt-1 block rounded-[8px] bg-pv-slate-50 px-2 py-1 text-[11px] font-mono text-pv-slate-700 break-all">
              {setup.secret}
            </code>
          </div>
        </div>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Codice a 6 cifre
          </span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-center text-[18px] font-mono tracking-widest"
          />
        </label>
        {error && <Alert variant="error">{error}</Alert>}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setStage('idle')}
            disabled={pending}
          >
            Annulla
          </Button>
          <Button
            size="sm"
            onClick={confirm}
            disabled={pending || code.length !== 6}
            loading={pending}
          >
            Conferma e attiva
          </Button>
        </div>
      </div>
    );
  }

  if (stage === 'showBackupCodes') {
    return (
      <div className="space-y-3">
        <Alert variant="success">
          ✓ <strong>2FA attivato.</strong> Salva i backup codes qui sotto:
          ti permetteranno di accedere se perdi l&apos;app authenticator.
        </Alert>
        <p className="text-[12.5px] text-pv-slate-700">
          <strong>Stampa o salva</strong> questi codici in un luogo sicuro.{' '}
          <strong>Non saranno più mostrati.</strong> Ogni codice è usabile una
          sola volta.
        </p>
        <div className="grid grid-cols-2 gap-2 rounded-[10px] bg-pv-slate-50 p-3 sm:grid-cols-5">
          {backupCodes.map((c) => (
            <code
              key={c}
              className="rounded-[6px] bg-white px-2 py-1 text-center text-[12.5px] font-mono text-pv-navy-900"
            >
              {c}
            </code>
          ))}
        </div>
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(backupCodes.join('\n'));
          }}
        >
          Copia tutti
        </Button>
        <p className="mt-3 text-[12px] text-pv-slate-500">
          Il 2FA è ora attivo. Verifica la verifica al prossimo login (TODO):
          oggi il check al sign-in è in fase di integrazione.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-pv-slate-700">
        Quando attivi il 2FA, al prossimo login ti verrà chiesto un codice
        a 6 cifre dall&apos;app authenticator. La password resta la
        prima barriera; il codice è la seconda.
      </p>
      {error && <Alert variant="error">{error}</Alert>}
      <Button onClick={start} disabled={pending} loading={pending}>
        Attiva 2FA
      </Button>
    </div>
  );
}
