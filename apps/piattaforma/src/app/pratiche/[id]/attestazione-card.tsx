import { Card } from '@/components/ui';
import { romeDataOraLeggibile } from '@/lib/date/rome-day';
import { attestazioniPerVersione } from '@/lib/legal/attestazioni';

type Dichiarazione = {
  createdAt: Date;
  ip: string | null;
  userAgent: string | null;
  popupVersion: string;
  testoAttestazioni: unknown;
  clausolaTerzi: number | null;
  user: { nome: string | null; cognome: string | null; email: string };
};

/** `testoAttestazioni` e' Json: stringente in lettura, il DB non lo tipizza. */
function testiPersistiti(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const testi = v
    .map((x) => (x && typeof x === 'object' && 'testo' in x ? String(x.testo) : null))
    .filter((t): t is string => t !== null);
  return testi.length > 0 ? testi : null;
}

/**
 * Prova dell'attestazione resa dal broker prima dell'invio (Termini 23.2).
 * Admin-only: contiene l'IP dell'utente, che e' un dato personale — a differenza
 * della diagnostica di copertura, qui non basta essere staff.
 */
export function AttestazioneCard({ dichiarazione }: { dichiarazione: Dichiarazione }) {
  const nome = [dichiarazione.user.nome, dichiarazione.user.cognome].filter(Boolean).join(' ');

  // Testo dal record; per i record <= v3.1 (scritti prima che venisse
  // persistito) si ricade sul registro tramite la versione.
  const dalRegistro = attestazioniPerVersione(dichiarazione.popupVersion);
  const testi = testiPersistiti(dichiarazione.testoAttestazioni) ?? dalRegistro?.map((a) => a.testo) ?? null;

  return (
    <Card>
      <h2 className="text-[15px] font-bold text-pv-navy-800">Attestazione del broker</h2>
      <p className="mt-1 text-[12px] text-pv-slate-500">
        Dichiarazione resa prima dell&apos;invio (Termini, clausola{' '}
        {dichiarazione.clausolaTerzi ?? 23}). Versione testo {dichiarazione.popupVersion}.
      </p>

      <dl className="mt-3 space-y-1 text-[13px]">
        <div className="flex justify-between gap-3">
          <dt className="text-pv-slate-500">Data e ora</dt>
          <dd className="font-semibold text-pv-navy-800">
            {romeDataOraLeggibile(dichiarazione.createdAt)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-pv-slate-500">Utente</dt>
          <dd className="truncate font-semibold text-pv-navy-800">
            {nome || dichiarazione.user.email}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-pv-slate-500">IP</dt>
          <dd className="font-semibold text-pv-navy-800">{dichiarazione.ip ?? '—'}</dd>
        </div>
      </dl>

      {testi ? (
        <ul className="mt-3 space-y-2">
          {testi.map((t, i) => (
            <li
              key={i}
              className="flex items-start gap-2 rounded-[10px] border border-pv-slate-200 px-3 py-2 text-[12.5px] text-pv-navy-800"
            >
              <span aria-hidden className="mt-0.5 shrink-0 font-bold text-pv-navy-700">
                ✓
              </span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      ) : (
        // Un blocco vuoto si leggerebbe come "nessuna attestazione", che e' la
        // conclusione opposta a quella vera.
        <p className="mt-3 rounded-[10px] bg-pv-amber-50 px-3 py-2 text-[12.5px] text-pv-navy-800">
          Testo non ricostruibile: la versione <strong>{dichiarazione.popupVersion}</strong> non è
          nel registro delle attestazioni. L&apos;attestazione è stata resa, ma il testo va
          recuperato dallo storico del codice.
        </p>
      )}

      {dichiarazione.userAgent && (
        <p className="mt-3 truncate text-[11px] text-pv-slate-500" title={dichiarazione.userAgent}>
          {dichiarazione.userAgent}
        </p>
      )}
    </Card>
  );
}
