'use client';

import { useEffect } from 'react';

/**
 * Cattura UTM first-touch alla landing. Al primo mount legge i parametri
 * utm_* dalla query string e, se almeno uno è presente E il cookie `pv_utm`
 * NON è ancora impostato (first-touch: non sovrascriviamo), salva un cookie
 * con i soli valori presenti. Il cookie verrà poi letto in `registerAction`
 * e persistito sulla Company. Non renderizza nulla.
 */

const COOKIE_NAME = 'pv_utm';
const MAX_AGE_SECONDS = 90 * 24 * 60 * 60; // 90 giorni
const MAX_LEN = 200;

function hasUtmCookie(): boolean {
  return document.cookie
    .split(';')
    .some((c) => c.trim().startsWith(`${COOKIE_NAME}=`));
}

export function UtmCapture() {
  useEffect(() => {
    // First-touch: se già catturato, non sovrascrivere.
    if (hasUtmCookie()) return;

    const params = new URLSearchParams(window.location.search);
    const fields: Record<string, string> = {};
    const map: Record<string, string> = {
      source: 'utm_source',
      medium: 'utm_medium',
      campaign: 'utm_campaign',
      content: 'utm_content',
    };

    for (const [key, param] of Object.entries(map)) {
      const value = params.get(param);
      if (value) fields[key] = value.slice(0, MAX_LEN);
    }

    // Scrivi solo se almeno un parametro UTM è presente.
    if (Object.keys(fields).length === 0) return;

    const value = encodeURIComponent(JSON.stringify(fields));
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  }, []);

  return null;
}
