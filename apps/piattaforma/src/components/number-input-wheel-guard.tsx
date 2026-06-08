'use client';

import { useEffect } from 'react';

/**
 * Neutralizza lo scroll-rotellina sui campi numerici a livello globale:
 * quando un `input[type=number]` ha il focus e l'utente scrolla, gli toglie il
 * focus invece di far cambiare il valore — così la pagina scorre normalmente e
 * il numero digitato non viene alterato per sbaglio.
 *
 * Montato una sola volta nel root layout. Non renderizza nulla.
 */
export function NumberInputWheelGuard(): null {
  useEffect(() => {
    const onWheel = (): void => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && el.type === 'number') {
        el.blur();
      }
    };
    document.addEventListener('wheel', onWheel, { passive: true });
    return () => document.removeEventListener('wheel', onWheel);
  }, []);
  return null;
}
