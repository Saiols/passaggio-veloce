'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const POLL_MS = 10_000;

type Evento = {
  id: string;
  tipo: string;
  titolo: string;
  testo: string;
  ctaLabel: string | null;
  ctaHref: string | null;
  praticaId: string | null;
  createdAt: string;
};

/**
 * Watcher globale degli eventi pratica: polla /api/eventi/pending ogni 10s (solo
 * a tab visibile) e mostra una MODALE centrata per ogni evento non visto della
 * controparte (broker <-> agenzia). Coda dal più recente; chiusura/CTA marcano
 * l'evento come visto (non riappare). Montato negli shell di agenzia e dealer.
 */
export function EventoPraticaWatcher() {
  const router = useRouter();
  const [queue, setQueue] = useState<Evento[]>([]);
  // id già gestiti localmente (dismissi o in dismissione): evita che il poll
  // successivo li re-inserisca prima che il server rifletta il "seen".
  const handledRef = useRef<Set<string>>(new Set());

  const merge = useCallback((eventi: Evento[]) => {
    setQueue((prev) => {
      const known = new Set(prev.map((e) => e.id));
      const fresh = eventi.filter((e) => !known.has(e.id) && !handledRef.current.has(e.id));
      if (fresh.length === 0) return prev;
      // newest-first per createdAt (l'API già ordina desc, ma riordiniamo dopo il merge).
      return [...fresh, ...prev].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const fetchPending = async (): Promise<void> => {
      try {
        const res = await fetch('/api/eventi/pending', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { eventi?: Evento[] };
        if (!cancelled && data.eventi) merge(data.eventi);
      } catch {
        /* rete assente: riprova al prossimo giro */
      }
    };

    const start = (): void => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') void fetchPending();
      }, POLL_MS);
    };
    const stop = (): void => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        void fetchPending();
        start();
      } else {
        stop();
      }
    };

    void fetchPending();
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [merge]);

  const current = queue[0];

  const dismiss = useCallback((id: string) => {
    handledRef.current.add(id);
    setQueue((prev) => prev.filter((e) => e.id !== id));
    void fetch('/api/eventi/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => undefined);
  }, []);

  // Esc chiude l'evento corrente.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss(current.id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [current, dismiss]);

  if (!current) return null;

  const onCta = () => {
    const href = current.ctaHref;
    dismiss(current.id);
    if (href) router.push(href);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onClick={() => dismiss(current.id)}
        className="absolute inset-0 bg-pv-navy-900/60 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="evento-pratica-titolo"
        className="relative w-full max-w-md rounded-[16px] border border-pv-slate-200 bg-white p-6 shadow-[0_24px_60px_rgba(10,15,31,0.35)]"
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-pv-orange-500">
          Aggiornamento pratica
        </p>
        <h2
          id="evento-pratica-titolo"
          className="mt-1.5 text-[19px] font-extrabold leading-tight text-pv-navy-900"
        >
          {current.titolo}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-pv-slate-600">{current.testo}</p>

        {queue.length > 1 && (
          <p className="mt-3 text-[12px] font-semibold text-pv-slate-400">
            +{queue.length - 1} altr{queue.length - 1 === 1 ? 'o aggiornamento' : 'i aggiornamenti'} in coda
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => dismiss(current.id)}
            className="rounded-[10px] border border-pv-slate-300 bg-white px-4 py-2.5 text-[13px] font-semibold text-pv-slate-700 transition-colors hover:bg-pv-slate-50"
          >
            Chiudi
          </button>
          {current.ctaHref && (
            <button
              type="button"
              onClick={onCta}
              className="rounded-[10px] bg-pv-navy-700 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-pv-navy-800"
            >
              {current.ctaLabel ?? 'Apri'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
