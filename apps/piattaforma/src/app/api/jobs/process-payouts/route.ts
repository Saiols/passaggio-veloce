import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { processPayouts } from '@/lib/jobs/process-payouts';

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN_PIATTAFORMA') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const result = await processPayouts();
  return NextResponse.json({ ok: true, ...result });
}
