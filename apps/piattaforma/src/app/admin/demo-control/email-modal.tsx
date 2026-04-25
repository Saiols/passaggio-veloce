'use client';

import { useState, type ReactNode } from 'react';

type Email = {
  id: string;
  subject: string | null;
  destinazione: string;
  bodyPreview: string | null;
  payload: unknown;
  tipo: string;
};

export function EmailModal({ email, children }: { email: Email; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  function extractLink(): string | null {
    if (!email.payload || typeof email.payload !== 'object') return null;
    const haystack = JSON.stringify(email.payload);
    const match = haystack.match(
      /"(https?:\/\/[^"]*\/(?:verify-email|reset-password|invito)[^"]*)"/,
    );
    return match?.[1] ?? null;
  }

  function copyLink() {
    const link = extractLink();
    if (link) navigator.clipboard.writeText(link);
  }

  const link = extractLink();

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block w-full text-left">
        {children}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-10"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-pv-slate-100 px-5 py-3">
              <div>
                <p className="font-bold text-pv-navy-900">
                  {email.subject ?? '(senza oggetto)'}
                </p>
                <p className="text-xs text-pv-slate-500">
                  A: {email.destinazione} · {email.tipo}
                </p>
              </div>
              <div className="flex gap-2">
                {link && (
                  <button
                    type="button"
                    onClick={copyLink}
                    className="rounded-lg bg-pv-navy-700 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Copia link
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-pv-slate-300 px-3 py-1.5 text-xs"
                >
                  Chiudi
                </button>
              </div>
            </header>

            <div className="max-h-[500px] overflow-auto rounded-b-2xl p-5 space-y-4">
              {email.bodyPreview && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-slate-500">
                    Anteprima testo
                  </p>
                  <p className="whitespace-pre-wrap rounded-lg bg-pv-slate-50 px-4 py-3 text-sm text-pv-navy-900">
                    {email.bodyPreview}
                  </p>
                </div>
              )}

              {link && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-slate-500">
                    Link azione
                  </p>
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block break-all rounded-lg bg-pv-navy-50 px-4 py-3 text-xs text-pv-navy-700 underline"
                  >
                    {link}
                  </a>
                </div>
              )}

              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-slate-500">
                  Payload
                </p>
                <pre className="overflow-auto rounded-lg bg-pv-slate-50 px-4 py-3 text-xs text-pv-navy-900">
                  {JSON.stringify(email.payload, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
