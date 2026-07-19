import type { Prisma } from '@pv/db';

export type GiustificativoFiltri = { dataDa: string | null; dataA: string | null };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function normDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!ISO_DATE.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}

export function parseGiustificativoFiltri(sp: { dataDa?: string; dataA?: string }): GiustificativoFiltri {
  return { dataDa: normDate(sp.dataDa), dataA: normDate(sp.dataA) };
}

export function parseGiustificativoFiltriFromUrl(url: URL): GiustificativoFiltri {
  return parseGiustificativoFiltri({
    dataDa: url.searchParams.get('dataDa') ?? undefined,
    dataA: url.searchParams.get('dataA') ?? undefined,
  });
}

export function giustificativoWhere(f: GiustificativoFiltri): Prisma.GiustificativoInternoWhereInput {
  if (!f.dataDa && !f.dataA) return {};
  const emessoAt: Prisma.DateTimeFilter = {};
  if (f.dataDa) emessoAt.gte = new Date(`${f.dataDa}T00:00:00.000Z`);
  if (f.dataA) emessoAt.lte = new Date(`${f.dataA}T23:59:59.999Z`);
  return { emessoAt };
}
