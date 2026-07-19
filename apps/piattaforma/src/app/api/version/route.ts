import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev';
  const ref = process.env.VERCEL_GIT_COMMIT_REF ?? 'local';
  return NextResponse.json({
    sha,
    shortSha: sha.slice(0, 7),
    branch: ref,
    deployedAt: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
  });
}
