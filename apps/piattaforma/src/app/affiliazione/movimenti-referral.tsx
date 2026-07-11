import Link from 'next/link';
import { formatCurrencyCent, formatDateTime } from '@/lib/format';
import { labelTipoTx } from '@/app/wallet/movimenti';

/** Riga movimento affiliazione: una CommissioneAffiliazione attribuita a un referral. */
export type RigaMovimentoAffiliazione = {
  id: string;
  createdAt: Date;
  importoNettoCent: number;
  stato: string;
  codicePratica: string | null;
  praticaId: string | null;
};

// Solo gli stati non-accreditati portano un tag: l'accreditata è la riga
// "normale" (verde), le altre restano attenuate col loro stato.
const STATO_TAG: Record<string, string> = {
  MATURATA: 'in maturazione',
  DA_REVISIONARE: 'in revisione',
  ANNULLATA: 'annullata',
};

/**
 * Lista dei movimenti (commissioni) di un singolo referral, nello stesso stile
 * della card "Movimenti" del wallet. La commissione ACCREDITATA concorre al
 * totale mostrato (importo verde +); le altre sono attenuate col proprio stato.
 */
export function MovimentiReferral({ righe }: { righe: RigaMovimentoAffiliazione[] }) {
  return (
    <ul className="divide-y divide-pv-slate-100 text-[13px]">
      {righe.map((m) => {
        const accreditata = m.stato === 'ACCREDITATA';
        const tag = STATO_TAG[m.stato];
        return (
          <li key={m.id} className="flex items-center justify-between py-2.5">
            <div className="min-w-0">
              <p className="font-semibold text-pv-navy-800">
                {labelTipoTx('CREDITO_AFFILIAZIONE')}
                {m.codicePratica && (
                  <span className="ml-2 font-mono text-[12px] font-normal text-pv-slate-500">
                    {m.praticaId ? (
                      <Link
                        href={`/pratiche/${m.praticaId}`}
                        className="font-semibold text-pv-navy-600 hover:underline"
                      >
                        {m.codicePratica}
                      </Link>
                    ) : (
                      m.codicePratica
                    )}
                  </span>
                )}
                {tag && (
                  <span className="ml-2 rounded-full bg-pv-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pv-slate-500">
                    {tag}
                  </span>
                )}
              </p>
              <p className="text-[11px] text-pv-slate-500">{formatDateTime(m.createdAt)}</p>
            </div>
            <p className={`font-bold ${accreditata ? 'text-pv-green-500' : 'text-pv-slate-400'}`}>
              {accreditata ? '+' : ''}
              {formatCurrencyCent(m.importoNettoCent)}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
