import { NextResponse } from 'next/server';
import { prisma } from '@pv/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const userCount = await prisma.user.count();
    const companyCount = await prisma.company.count();
    const praticaCount = await prisma.pratica.count();
    return NextResponse.json({
      ok: true,
      counts: { users: userCount, companies: companyCount, pratiche: praticaCount },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'unknown',
      },
      { status: 500 },
    );
  }
}
