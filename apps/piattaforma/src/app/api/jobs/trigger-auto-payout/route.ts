import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { triggerAutoPayout } from '@/lib/jobs/trigger-auto-payout';

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN_PIATTAFORMA') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const result = await triggerAutoPayout();
  return NextResponse.json({ ok: true, ...result });
}
