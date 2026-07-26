'use client';

import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { COOKIE_CONSENT_EVENT, COOKIE_CONSENT_STORAGE_KEY } from '@/lib/analytics/consent';
import { GA_MEASUREMENT_ID, gaCookieNames, gaDisableFlag, shouldLoadGa } from '@/lib/analytics/ga';

type GtagWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

function subscribeToConsent(callback: () => void): () => void {
  const handler = (): void => callback();
  window.addEventListener('storage', handler);
  window.addEventListener(COOKIE_CONSENT_EVENT, handler);
  return () => {
    window.removeEventListener('storage', handler);
    window.removeEventListener(COOKIE_CONSENT_EVENT, handler);
  };
}

/**
 * Installa la coda `dataLayer` e la funzione `gtag` se non ci sono già.
 *
 * È lo shim dello snippet ufficiale, e serve proprio perché gtag.js arriva
 * DOPO: ogni chiamata fatta prima finisce in coda e viene consumata al
 * caricamento. Senza, il primo `page_view` — quello dell'atterraggio, il più
 * importante — andrebbe perso, perché gli effect di React girano molto prima
 * che uno script `afterInteractive` sia stato scaricato ed eseguito.
 */
function ensureGtag(): (...args: unknown[]) => void {
  const w = window as GtagWindow;
  w.dataLayer = w.dataLayer ?? [];
  if (!w.gtag) {
    // Copia fedele dello snippet ufficiale: in coda va l'oggetto `arguments`,
    // non un array. gtag.js si aspetta quello, e non usiamo i rest parameter
    // proprio perché li renderebbero un array.
    w.gtag = function gtagShim() {
      // eslint-disable-next-line prefer-rest-params
      (w.dataLayer as unknown[]).push(arguments);
    } as (...args: unknown[]) => void;
  }
  return w.gtag;
}

/**
 * Google Analytics 4, subordinato al consenso.
 *
 * Il tag NON viene montato finché entrambe le condizioni di `shouldLoadGa` non
 * sono vere (ID configurato + consenso analytics prestato): niente script di
 * Google, niente cookie `_ga`, nessuna richiesta verso googletagmanager.com. È
 * il modello "prior blocking" che la direttiva ePrivacy e il Garante
 * pretendono — caricare gtag.js e poi negare il consenso via Consent Mode non
 * basta, perché la richiesta al terzo è già partita e il terzo ha già visto
 * l'IP.
 *
 * Senza `NEXT_PUBLIC_GA_MEASUREMENT_ID` il componente rende sempre `null`:
 * finché la proprietà GA4 non esiste il codice sta in produzione ed è inerte.
 *
 * ⚠️ Va montato dentro un `<Suspense>`: usa `useSearchParams()`, che senza
 * boundary forzerebbe l'intera app al rendering dinamico.
 */
export function GoogleAnalytics() {
  const consentRaw = useSyncExternalStore(
    subscribeToConsent,
    () => window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY),
    () => null, // SSR: lato server non esiste consenso, il tag nasce nel browser
  );
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const configurato = useRef(false);

  const enabled = shouldLoadGa({ measurementId: GA_MEASUREMENT_ID, consentRaw });

  // Revoca del consenso DOPO il caricamento: in quella sessione gtag.js resta
  // in pagina, quindi lo spegniamo col flag globale e ripuliamo i cookie che
  // aveva scritto. Senza, "Solo necessari" premuto in un secondo momento non
  // avrebbe alcun effetto fino al reload — e l'art. 7.3 GDPR vuole che
  // revocare sia facile quanto acconsentire.
  useEffect(() => {
    if (!GA_MEASUREMENT_ID) return;
    // Il nome del flag è calcolato a runtime (`ga-disable-<ID>`): non è una
    // proprietà nota di Window, serve l'accesso per indice.
    (window as unknown as Record<string, unknown>)[gaDisableFlag(GA_MEASUREMENT_ID)] = !enabled;
    if (enabled) return;
    configurato.current = false;
    for (const name of gaCookieNames(document.cookie)) {
      // `_ga` è scritto sul dominio registrabile (`.passaggioveloce.it`):
      // cancellarlo senza `domain` non lo tocca. Proviamo entrambe le forme.
      document.cookie = `${name}=; Max-Age=0; path=/`;
      document.cookie = `${name}=; Max-Age=0; path=/; domain=.${window.location.hostname}`;
    }
  }, [enabled]);

  // Configurazione + page view. Stanno nello stesso effect per un motivo di
  // ordine: `config` deve entrare in `dataLayer` PRIMA del primo `page_view`,
  // altrimenti l'evento non è attribuito ad alcuna proprietà. Se la config
  // vivesse in uno <Script> inline, l'ordine dipenderebbe da quale dei due
  // arriva prima — e non è deciso da noi.
  //
  // `send_page_view: false` disattiva la page view automatica: in App Router
  // scatterebbe solo al primo caricamento e mai più sulle navigazioni
  // client-side, registrando una sola pagina per sessione.
  useEffect(() => {
    if (!enabled) return;
    const gtag = ensureGtag();
    if (!configurato.current) {
      gtag('js', new Date());
      gtag('consent', 'default', {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'granted',
      });
      gtag('config', GA_MEASUREMENT_ID, { send_page_view: false });
      configurato.current = true;
    }
    const qs = searchParams?.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    gtag('event', 'page_view', {
      page_path: url,
      page_location: `${window.location.origin}${url}`,
      page_title: document.title,
    });
  }, [enabled, pathname, searchParams]);

  if (!enabled) return null;

  return (
    <Script
      id="ga-src"
      strategy="afterInteractive"
      src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
    />
  );
}
