import type { Prisma, DocumentoFiscaleTipo } from '@pv/db';

/**
 * Filtri condivisi delle liste fatturazione (broker/agenzia/admin), riusati
 * anche da export CSV e ZIP così la "vista" e i "download" restano coerenti.
 * Modulo PURO (no IO): parsing dei searchParams + costruzione del `where`.
 */

export const TIPI_DOC: DocumentoFiscaleTipo[] = [
  'FATTURA_PV',
  'DOC_BROKER',
  'NOTA_VARIAZIONE',
  'PENALE_BROKER',
];

export type FatturaFiltri = {
  q: string;
  tipo: DocumentoFiscaleTipo | null;
  dataDa: string | null; // 'YYYY-MM-DD'
  dataA: string | null; // 'YYYY-MM-DD'
  sedeId: string | null;
};

function isYmd(s: string | undefined | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Normalizza i parametri (searchParams/URL) nei filtri fattura. */
export function parseFatturaFiltri(sp: {
  q?: string;
  tipo?: string;
  dataDa?: string;
  dataA?: string;
  sede?: string;
}): FatturaFiltri {
  return {
    q: (sp.q ?? '').trim(),
    tipo: TIPI_DOC.includes(sp.tipo as DocumentoFiscaleTipo)
      ? (sp.tipo as DocumentoFiscaleTipo)
      : null,
    dataDa: isYmd(sp.dataDa) ? sp.dataDa : null,
    dataA: isYmd(sp.dataA) ? sp.dataA : null,
    sedeId: sp.sede && sp.sede.trim() ? sp.sede.trim() : null,
  };
}

/**
 * Clausole Prisma dei filtri (q/tipo/intervallo date/sede), da combinare con lo
 * scope del ruolo. Entrambi possono restituire una chiave `AND`: comporli con
 * `{ AND: [scope, fatturaWhereFiltri(f)] }`, MAI con lo spread
 * `{ ...scope, ...fatturaWhereFiltri(f) }`, che sovrascriverebbe silenziosamente
 * l'`AND` dello scope con quello dei filtri (leak: i filtri utente
 * cancellerebbero lo scoping per company/sede). Le date sono giorni interi in
 * UTC. La "sede" matcha la sede agenzia/broker della pratica oppure quella del
 * wallet del payout (documenti broker aggregati).
 */
export function fatturaWhereFiltri(f: FatturaFiltri): Prisma.DocumentoFiscaleWhereInput {
  const and: Prisma.DocumentoFiscaleWhereInput[] = [];
  if (f.tipo) and.push({ tipo: f.tipo });
  if (f.q) {
    const numQ = /^\d+$/.test(f.q) ? Number(f.q) : null;
    and.push({
      OR: [
        { pratica: { codicePratica: { contains: f.q, mode: 'insensitive' } } },
        ...(numQ !== null ? [{ numeroProgressivo: numQ }] : []),
      ],
    });
  }
  if (f.dataDa || f.dataA) {
    and.push({
      emessoAt: {
        ...(f.dataDa ? { gte: new Date(`${f.dataDa}T00:00:00.000Z`) } : {}),
        ...(f.dataA ? { lte: new Date(`${f.dataA}T23:59:59.999Z`) } : {}),
      },
    });
  }
  if (f.sedeId) {
    and.push({
      OR: [
        { pratica: { agenziaSedeId: f.sedeId } },
        { pratica: { brokerSedeId: f.sedeId } },
        { payout: { wallet: { sedeId: f.sedeId } } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

/** Query-string dei filtri attivi (per href export/ZIP che li preservano). */
export function fatturaFiltriToQuery(f: FatturaFiltri): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.tipo) p.set('tipo', f.tipo);
  if (f.dataDa) p.set('dataDa', f.dataDa);
  if (f.dataA) p.set('dataA', f.dataA);
  if (f.sedeId) p.set('sede', f.sedeId);
  return p.toString();
}
