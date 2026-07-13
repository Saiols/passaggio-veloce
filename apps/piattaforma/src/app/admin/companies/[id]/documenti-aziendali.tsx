import Link from 'next/link';
import { Card } from '@/components/ui';
import { labelDocumentoTipo } from '@/lib/documenti/labels';
import { formatDate } from '@/lib/format';

type Doc = {
  id: string;
  tipo: string;
  sizeBytes: number;
  createdAt: Date;
};

function formatKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Documenti KYC dell'azienda (CI, codice fiscale, visura), caricati in
 * registrazione. Esistono da sempre come righe `Documento` con `companyId`, ma
 * finora nessuna pagina ne esponeva gli id: di fatto erano irraggiungibili.
 *
 * Riservata ad ADMIN_PIATTAFORMA: `/api/documenti/[id]` nega già l'Assistente
 * (documenti d'identità del legale rappresentante), quindi mostrargli i bottoni
 * significherebbe solo prometter loro dei 403.
 */
export function DocumentiAziendali({
  companyId,
  documenti,
}: {
  companyId: string;
  documenti: Doc[];
}) {
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[16px] font-bold text-pv-navy-900">Documenti aziendali</h2>
          <p className="mt-0.5 text-[12px] text-pv-slate-500">
            Caricati in registrazione. Il mandato firmato, se presente, è incluso nello ZIP.
          </p>
        </div>
        {documenti.length > 0 && (
          <a
            href={`/api/admin/companies/${companyId}/documenti-zip`}
            className="rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-bold text-white hover:brightness-110"
          >
            Scarica tutti (ZIP)
          </a>
        )}
      </div>

      {documenti.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-pv-slate-500">
          Nessun documento caricato. Le aziende registrate prima del KYC non ne hanno.
        </p>
      ) : (
        <ul className="divide-y divide-pv-slate-100">
          {documenti.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-pv-navy-800">
                  {labelDocumentoTipo(d.tipo)}
                </p>
                <p className="text-[12px] text-pv-slate-500">
                  {formatDate(d.createdAt)} · {formatKb(d.sizeBytes)}
                </p>
              </div>
              <Link
                href={`/api/documenti/${d.id}`}
                className="shrink-0 rounded-[10px] border border-pv-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
              >
                Scarica
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
