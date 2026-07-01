'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LoadingOverlay } from './loading-overlay';

/**
 * Overlay di caricamento GLOBALE per le NAVIGAZIONI (sidebar, tab, filtri a
 * link, paginazione, link di dettaglio): le navigazioni client-side <Link> non
 * ricaricano la pagina e possono sembrare "morte" mentre il server component si
 * carica. Mostra l'overlay al click su un link interno e lo nasconde quando la
 * nuova rotta (path o query) è montata.
 *
 * Copre anche i form di FILTRO con `method="get"` esplicito: ne intercetta il
 * submit e naviga client-side (così l'overlay resta visibile), invece del reload
 * nativo. NON tocca i form delle server action (che non usano method="get").
 *
 * Le azioni server (salvataggi/azioni) usano invece [LoadingOverlay] legato al
 * pending della loro useTransition — vedi use-action-overlay.tsx.
 */
export function GlobalNavOverlay() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Chiave della rotta corrente (path + query). Quando cambia, la navigazione è
  // completata.
  const locationKey = `${pathname}?${searchParams.toString()}`;

  // Pagina di PARTENZA di una navigazione in corso: l'overlay è visibile finché
  // siamo ancora su quella pagina. Appena la rotta cambia, `show` diventa false
  // in modo DERIVATO (nessun setState dentro un effetto).
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = pendingFrom !== null && pendingFrom === locationKey;

  useEffect(() => {
    const currentKey = () =>
      `${window.location.pathname}?${new URLSearchParams(window.location.search).toString()}`;

    const start = () => {
      setPendingFrom(currentKey());
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      // Safety: se una navigazione non si completa (annullata/errore), evita
      // che l'overlay resti appeso.
      timeoutRef.current = setTimeout(() => setPendingFrom(null), 12000);
    };

    const onClick = (e: MouseEvent) => {
      // Solo click sinistro senza modificatori (no nuova scheda/finestra).
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;
      const a = anchor as HTMLAnchorElement;
      if (a.target && a.target !== '_self') return;
      if (a.hasAttribute('download')) return;
      if ((a.getAttribute('rel') ?? '').includes('external')) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:'))
        return;
      let dest: URL;
      try {
        dest = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (dest.origin !== window.location.origin) return; // link esterno
      // Route /api/* = download/dati (attachment), non cambiano la rotta: non
      // mostrare l'overlay (resterebbe appeso).
      if (dest.pathname.startsWith('/api/')) return;
      if (`${dest.pathname}?${dest.searchParams.toString()}` === currentKey()) return; // stessa URL
      start();
    };

    const onSubmit = (e: SubmitEvent) => {
      if (e.defaultPrevented) return;
      const form = e.target as HTMLFormElement | null;
      if (!form) return;
      // SOLO i form di filtro/navigazione GET espliciti (i form delle server
      // action non impostano method="get").
      if ((form.getAttribute('method') ?? '').toLowerCase() !== 'get') return;
      const actionAttr = form.getAttribute('action') || window.location.pathname;
      let dest: URL;
      try {
        dest = new URL(actionAttr, window.location.href);
      } catch {
        return;
      }
      if (dest.origin !== window.location.origin) return;
      const params = new URLSearchParams();
      for (const [k, v] of new FormData(form).entries()) {
        if (typeof v === 'string' && v !== '') params.append(k, v);
      }
      const qs = params.toString();
      const url = `${dest.pathname}${qs ? `?${qs}` : ''}`;
      // Converte il GET nativo in navigazione client-side con overlay.
      e.preventDefault();
      if (`${dest.pathname}?${qs}` !== currentKey()) start();
      router.push(url);
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', onSubmit, true);
    };
  }, [router]);

  return <LoadingOverlay show={show} label="Caricamento…" />;
}
