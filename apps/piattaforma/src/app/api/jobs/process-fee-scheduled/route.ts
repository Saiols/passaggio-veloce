import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { processFeeScheduled } from '@/lib/jobs/process-fee-scheduled';

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN_PIATTAFORMA') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const result = await processFeeScheduled();
  return NextResponse.json({ ok: true, ...result });
}
