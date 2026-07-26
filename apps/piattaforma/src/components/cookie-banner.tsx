'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  COOKIE_CONSENT_EVENT,
  COOKIE_CONSENT_STORAGE_KEY,
  serializeConsent,
} from '@/lib/analytics/consent';

function subscribeToStorage(callback: () => void): () => void {
  const handler = (): void => callback();
  window.addEventListener('storage', handler);
  window.addEventListener(COOKIE_CONSENT_EVENT, handler);
  return () => {
    window.removeEventListener('storage', handler);
    window.removeEventListener(COOKIE_CONSENT_EVENT, handler);
  };
}

/**
 * Riapre il banner cancellando la scelta salvata. Esportata perché la revoca
 * dev'essere raggiungibile in ogni momento (art. 7.3 GDPR: revocare facile
 * quanto acconsentire) — la usa il bottone della cookie policy. Finché non
 * c'era alcun cookie analytics il punto era teorico; con Google Analytics
 * attivo non lo è più.
 */
export function riapriPreferenzeCookie(): void {
  window.localStorage.removeItem(COOKIE_CONSENT_STORAGE_KEY);
  window.dispatchEvent(new Event(COOKIE_CONSENT_EVENT));
}

/**
 * Cookie banner GDPR-compliant. Mostrato finché l'utente non sceglie:
 *  - "Accetta tutti" → tutti i flag a true
 *  - "Solo necessari" → analytics + marketing false
 *  - "Personalizza" → modale con toggle granulari
 *
 * La scelta viene salvata in localStorage sotto la chiave condivisa di
 * `lib/analytics/consent.ts`, che è anche quella letta da `GoogleAnalytics`:
 * il flag `analytics` è ciò che accende o spegne il tag GA4. Finché non
 * esisteva alcun cookie analytics questo banner era un pattern a vuoto; da
 * quando GA è installato, è il gate vero.
 */
export function CookieBanner() {
  // useSyncExternalStore per evitare flash + reagire a cambi LocalStorage
  // multi-tab. SSR safe: in SSR ritorna sempre null → banner nascosto.
  const consentRaw = useSyncExternalStore(
    subscribeToStorage,
    () => window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY),
    () => null,
  );
  const [customizing, setCustomizing] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  // Visibilità DERIVATA dal record, senza un `dismissed` locale. Prima ce
  // n'era uno, ed era due volte sbagliato: restava true anche dopo la revoca
  // dalla cookie policy (il banner non riappariva più fino al reload), e
  // nascondeva il banner anche quando `setItem` falliva — Safari in
  // navigazione privata lancia — cioè quando il consenso NON era stato
  // registrato. `save()` scrive ed emette l'evento in modo sincrono, quindi
  // `useSyncExternalStore` rilegge subito: il banner sparisce comunque, ma
  // solo se il salvataggio è davvero andato a buon fine.
  const shown = consentRaw === null;

  const save = (c: { analytics: boolean; marketing: boolean }): void => {
    window.localStorage.setItem(
      COOKIE_CONSENT_STORAGE_KEY,
      serializeConsent(c, new Date().toISOString()),
    );
    // Notifica i listener (storage event nello stesso tab non si emette)
    window.dispatchEvent(new Event(COOKIE_CONSENT_EVENT));
    setCustomizing(false);
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
                (sempre attivi). Per le statistiche di utilizzo usiamo{' '}
                <strong>Google Analytics</strong>, che scrive cookie propri e può
                trasferire dati negli Stati Uniti: si attiva solo se acconsenti, e
                puoi cambiare idea quando vuoi. Trovi i dettagli nella{' '}
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
                    Google Analytics 4: statistiche di utilizzo per migliorare
                    la piattaforma. Cookie <code>_ga</code>, durata 2 anni,
                    dati trattati anche negli Stati Uniti.
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
                    Campagne e remarketing. Nessun cookie di terze parti
                    attualmente attivo.
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
