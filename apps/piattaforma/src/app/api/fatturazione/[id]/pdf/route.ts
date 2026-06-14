import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { formatDate } from '@/lib/format';
import { numeroDocumento, labelTipoDocumento } from '@/lib/fatturazione/format';
import { buildDocumentoPdf } from '@/lib/fatturazione/pdf';
import type { DatiFiscali } from '@/lib/fatturazione/pv-emittente';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/fatturazione/[id]/pdf — scarica il PDF del documento fiscale.
 * Access control identico al dettaglio: admin, oppure la company dell'utente
 * è emittente o destinatario del documento.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const doc = await prisma.documentoFiscale.findUnique({
    where: { id },
    include: {
      pratica: { select: { codicePratica: true } },
      payout: {
        select: {
          eseguitoAt: true,
          transazioni: {
            where: { tipo: 'CREDITO_PRATICA' },
            select: { pratica: { select: { codicePratica: true } } },
          },
        },
      },
      notaVariazionePer: { select: { numeroProgressivo: true, anno: true } },
    },
  });
  if (!doc) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const isAdmin = session.user.role === 'ADMIN_PIATTAFORMA';
  const cid = session.user.companyId;
  const allowed =
    isAdmin ||
    (doc.emittenteCompanyId != null && doc.emittenteCompanyId === cid) ||
    (doc.destinatarioCompanyId != null && doc.destinatarioCompanyId === cid);
  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Descrizione + riferimento per tipo documento.
  let descrizione: string;
  let riferimento: string | null = null;
  switch (doc.tipo) {
    case 'FATTURA_PV':
      descrizione = 'Servizio di intermediazione per passaggio di proprietà';
      riferimento = doc.pratica?.codicePratica ? `Pratica ${doc.pratica.codicePratica}` : null;
      break;
    case 'DOC_BROKER': {
      descrizione = 'Compenso di intermediazione';
      const codici = (doc.payout?.transazioni ?? [])
        .map((t) => t.pratica?.codicePratica)
        .filter((c): c is string => Boolean(c));
      const dataPayout = doc.payout?.eseguitoAt ? formatDate(doc.payout.eseguitoAt) : '—';
      riferimento = `Payout del ${dataPayout}${codici.length ? ` · pratiche: ${codici.join(', ')}` : ''}`;
      break;
    }
    case 'NOTA_VARIAZIONE':
      descrizione = doc.notaVariazionePer
        ? `Storno documento N° ${numeroDocumento(doc.notaVariazionePer)}`
        : 'Nota di variazione in diminuzione';
      riferimento = doc.pratica?.codicePratica ? `Pratica ${doc.pratica.codicePratica}` : null;
      break;
    case 'PENALE_BROKER':
      descrizione = 'Penale';
      riferimento = doc.pratica?.codicePratica ? `Pratica ${doc.pratica.codicePratica}` : null;
      break;
    default:
      descrizione = labelTipoDocumento(doc.tipo);
  }

  const pdfBytes = await buildDocumentoPdf({
    tipo: doc.tipo,
    fatturaPaTipo: doc.fatturaPaTipo,
    numeroProgressivo: doc.numeroProgressivo,
    anno: doc.anno,
    emessoAt: doc.emessoAt,
    emittente: doc.datiEmittente as unknown as DatiFiscali,
    destinatario: doc.datiDestinatario as unknown as DatiFiscali,
    imponibileCent: doc.imponibileCent,
    ivaCent: doc.ivaCent,
    aliquotaIvaPct: doc.aliquotaIvaPct,
    importoLordoCent: doc.importoLordoCent,
    descrizione,
    riferimento,
  });

  const filename = `${labelTipoDocumento(doc.tipo).replace(/\s+/g, '-').toLowerCase()}-${doc.numeroProgressivo}-${doc.anno}.pdf`;

  return new Response(pdfBytes as BlobPart, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
