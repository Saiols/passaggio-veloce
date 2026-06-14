'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const POLL_MS = 25_000;

/**
 * Badge real-time per una voce di navigazione. Legge il conteggio da
 * /api/badges (campo `keyName`), polla ogni 25s SOLO a tab visibile e refetcha
 * al ritorno del focus. Quando il conteggio AUMENTA fa router.refresh() così la
 * lista sottostante (Inbox/Dashboard) si aggiorna senza reload manuale.
 */
export function NavBadge({ keyName = 'inbox' }: { keyName?: string }) {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const prev = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const fetchCount = async (): Promise<void> => {
      try {
        const res = await fetch('/api/badges', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as Record<string, number>;
        const next = data[keyName] ?? 0;
        if (cancelled) return;
        setCount(next);
        if (next > prev.current) router.refresh();
        prev.current = next;
      } catch {
        // rete assente: mantieni l'ultimo valore noto
      }
    };

    const start = (): void => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') void fetchCount();
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
        void fetchCount();
        start();
      } else {
        stop();
      }
    };

    void fetchCount(); // primo fetch al mount
    start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [keyName, router]);

  if (count <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-pv-orange-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-[#1a1a1a]">
      {count > 99 ? '99+' : count}
    </span>
  );
}
