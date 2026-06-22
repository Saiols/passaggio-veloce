'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'pv-cookie-consent-v1';

function subscribeToStorage(callback: () => void): () => void {
  const handler = (): void => callback();
  window.addEventListener('storage', handler);
  window.addEventListener('pv-cookie-consent', handler);
  return () => {
    window.removeEventListener('storage', handler);
    window.removeEventListener('pv-cookie-consent', handler);
  };
}

type Consent = {
  essenziali: true; // sempre true (necessari per il login)
  analytics: boolean;
  marketing: boolean;
  ts: string;
};

/**
 * Cookie banner GDPR-compliant. Mostrato finché l'utente non sceglie:
 *  - "Accetta tutti" → tutti i flag a true
 *  - "Solo necessari" → analytics + marketing false
 *  - "Personalizza" → modale con toggle (parità soft: oggi non abbiamo
 *    cookie analytics né marketing, ma il pattern è già pronto per quando
 *    si attiveranno).
 *
 * La scelta viene salvata in localStorage. Pattern compatibile con la
 * direttiva ePrivacy + Garante Privacy ITA (preferenze granulari).
 */
export function CookieBanner() {
  // useSyncExternalStore per evitare flash + reagire a cambi LocalStorage
  // multi-tab. SSR safe: in SSR ritorna sempre null → banner nascosto.
  const consentRaw = useSyncExternalStore(
    subscribeToStorage,
    () => window.localStorage.getItem(STORAGE_KEY),
    () => null,
  );
  const [dismissed, setDismissed] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  const shown = !dismissed && consentRaw === null;

  const save = (c: Omit<Consent, 'ts' | 'essenziali'>): void => {
    const consent: Consent = {
      essenziali: true,
      analytics: c.analytics,
      marketing: c.marketing,
      ts: new Date().toISOString(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
    // Notifica i listener (storage event nello stesso tab non si emette)
    window.dispatchEvent(new Event('pv-cookie-consent'));
    setDismissed(true);
  };

  if (!shown) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-pv-slate-200 bg-white shadow-[0_-8px_24px_rgb(10_37_64_/_0.08)]">
      <div className="mx-auto max-w-5xl px-5 py-4 sm:px-6">
        {!customizing ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-pv-navy-900">Cookie e privacy</p>
              <p className="mt-1 text-[12.5px] text-pv-slate-700">
                Usiamo cookie tecnici per il login e il funzionamento della piattaforma
                (sempre attivi). Per analytics e marketing chiediamo il tuo consenso.
                Trovi i dettagli nella{' '}
                <Link href="/cookie" className="font-semibold text-pv-navy-700 hover:underline">
                  Cookie Policy
                </Link>{' '}
                e nella{' '}
                <Link href="/privacy" className="font-semibold text-pv-navy-700 hover:underline">
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
            <div className="flex flex-wrap gap-2 sm:shrink-0">
              <button
                type="button"
                onClick={() => save({ analytics: false, marketing: false })}
                className="rounded-[10px] border border-pv-slate-300 bg-white px-3 py-2 text-[12.5px] font-semibold text-pv-slate-700 hover:bg-pv-slate-50"
              >
                Solo necessari
              </button>
              <button
                type="button"
                onClick={() => setCustomizing(true)}
                className="rounded-[10px] border border-pv-slate-300 bg-white px-3 py-2 text-[12.5px] font-semibold text-pv-slate-700 hover:bg-pv-slate-50"
              >
                Personalizza
              </button>
              <button
                type="button"
                onClick={() => save({ analytics: true, marketing: true })}
                className="rounded-[10px] bg-pv-navy-700 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-pv-navy-800"
              >
                Accetta tutti
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-[14px] font-bold text-pv-navy-900">
              Personalizza cookie
            </p>
            <ul className="mt-3 space-y-2 text-[12.5px]">
              <li className="flex items-start justify-between gap-3 rounded-[10px] bg-pv-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-semibold text-pv-navy-900">Necessari</p>
                  <p className="text-[11.5px] text-pv-slate-500">
                    Login, sessione, sicurezza. Sempre attivi.
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-pv-green-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-pv-green-500">
                  Sempre attivo
                </span>
              </li>
              <li className="flex items-start justify-between gap-3 rounded-[10px] bg-pv-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-semibold text-pv-navy-900">Analytics</p>
                  <p className="text-[11.5px] text-pv-slate-500">
                    Statistiche aggregate per migliorare la piattaforma.
                    Nessun cookie di terze parti attualmente attivo.
                  </p>
                </div>
                <Toggle
                  checked={analytics}
                  onChange={setAnalytics}
                  label="Analytics"
                />
              </li>
              <li className="flex items-start justify-between gap-3 rounded-[10px] bg-pv-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-semibold text-pv-navy-900">Marketing</p>
                  <p className="text-[11.5px] text-pv-slate-500">
                    Tracking referral e campagne. Nessun cookie di terze
                    parti attualmente attivo.
                  </p>
                </div>
                <Toggle
                  checked={marketing}
                  onChange={setMarketing}
                  label="Marketing"
                />
              </li>
            </ul>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setCustomizing(false)}
                className="rounded-[10px] border border-pv-slate-300 px-3 py-2 text-[12.5px] font-semibold text-pv-slate-700 hover:bg-pv-slate-50"
              >
                Indietro
              </button>
              <button
                type="button"
                onClick={() => save({ analytics, marketing })}
                className="rounded-[10px] bg-pv-navy-700 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-pv-navy-800"
              >
                Salva preferenze
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ' +
        (checked ? 'bg-pv-navy-700' : 'bg-pv-slate-300')
      }
    >
      <span
        className={
          'absolute h-5 w-5 rounded-full bg-white shadow transition ' +
          (checked ? 'translate-x-5' : 'translate-x-0.5')
        }
      />
    </button>
  );
}
