'use client';

import { useState } from 'react';

export function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback silenzioso se clipboard API non disponibile.
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-pv-navy-800"
    >
      {copied ? 'Copiato ✓' : 'Copia link'}
    </button>
  );
}
