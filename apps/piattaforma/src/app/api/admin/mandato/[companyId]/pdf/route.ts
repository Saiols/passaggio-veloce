import { NextResponse } from 'next/server';
import { prisma } from '@pv/db';
import { auth } from '@/auth';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { storageGetBuffer } from '@/lib/providers/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ companyId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user || !isAdminPiattaforma(session.user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const { companyId } = await params;

  const mandato = await prisma.mandatoFatturazione.findUnique({
    where: { companyId },
    select: { storageKey: true },
  });
  if (!mandato) {
    return new NextResponse('Not found', { status: 404 });
  }

  const buffer = await storageGetBuffer(mandato.storageKey);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="mandato-${companyId}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
