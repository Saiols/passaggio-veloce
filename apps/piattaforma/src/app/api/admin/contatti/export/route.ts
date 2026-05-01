import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isAdminOrAssistente } from '@/lib/auth/permissions';
import { buildCatalogoContatti } from '@/lib/catalogo-contatti';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // Catalogo contatti accessibile sia ad ADMIN che ad ASSISTENTE (D-02).
  if (!isAdminOrAssistente(session.user.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() || undefined;

  const contatti = await buildCatalogoContatti(q);

  const headers = [
    'nominativo',
    'ruolo',
    'tipo',
    'email',
    'telefono',
    'identificativoFiscale',
    'numeroPratiche',
    'ultimaPraticaAt',
  ];
  const rows = contatti.map((c) => [
    c.nominativo,
    c.ruolo,
    c.isPersonaGiuridica ? 'PG' : 'PF',
    c.email ?? '',
    c.telefono ?? '',
    c.identificativoFiscale ?? '',
    c.numeroPratiche,
    c.ultimoVistoAt.toISOString(),
  ]);

  const csv = [
    headers.join(','),
    ...rows.map((r) => r.map(csvEscape).join(',')),
  ].join('\n');

  const filename = `contatti-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
