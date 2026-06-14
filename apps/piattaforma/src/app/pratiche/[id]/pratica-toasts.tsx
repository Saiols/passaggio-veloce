'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/ui';

/** Converte i flag ?firmata/?processata/?annullata/?error in toast e pulisce l'URL. */
export function PraticaToasts() {
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const firmata = params.get('firmata');
    const processata = params.get('processata');
    const annullata = params.get('annullata');
    const error = params.get('error');
    if (firmata) toast('Firma registrata: credito accreditato al broker', 'success');
    else if (processata) toast('Pratica processata: il broker è stato avvisato', 'success');
    else if (annullata) toast('Pratica annullata', 'info');
    else if (error) toast(error, 'error');
    if (firmata || processata || annullata || error) {
      router.replace(window.location.pathname);
    }
  }, [params, router, toast]);

  return null;
}
