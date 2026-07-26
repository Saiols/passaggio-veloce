import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isAdminOrAssistente } from '@/lib/auth/permissions';
import { registraLogAsync } from '@/lib/audit/log-accessi';
import { buildCatalogoContatti } from '@/lib/catalogo-contatti';
import { romeIsoDate } from '@/lib/date/rome-day';

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
  const ruoloParam = url.searchParams.get('ruolo');
  const ruoloFilter =
    ruoloParam === 'VENDITORE' || ruoloParam === 'ACQUIRENTE' ? ruoloParam : null;

  const contattiAll = await buildCatalogoContatti(q);
  // Esporta coerentemente col filtro tipologia attivo nella pagina.
  const contatti = ruoloFilter
    ? contattiAll.filter((c) => c.ruolo === ruoloFilter)
    : contattiAll;

  // Log accessi: è un'estrazione massiva dei dati di venditori e acquirenti —
  // persone che non sono nostri utenti. Se questo elenco finisse dove non
  // deve, è l'unica riga che dice chi lo ha tirato fuori, quando e quanto
  // grande era. Il filtro finisce nel dettaglio: serve a ricostruire
  // l'estrazione, non a giudicarla.
  registraLogAsync({
    azione: 'EXPORT_DATI',
    userId: session.user.id,
    email: session.user.email,
    companyId: session.user.companyId ?? null,
    risorsaTipo: 'contatti-crm',
    dettaglio: `${contatti.length} contatti${ruoloFilter ? ` (${ruoloFilter})` : ''}${q ? ` · ricerca "${q}"` : ''}`,
  });

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

  const filename = `contatti-${romeIsoDate(new Date())}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
