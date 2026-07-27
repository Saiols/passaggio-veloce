import { NextResponse, type NextRequest } from 'next/server';
import { syncCrmFromPlatform } from '@/lib/crm/sync';
import { riconciliaTutto } from '@/lib/crm/match/apply';
import { requireAdminOrCron } from '@/lib/jobs/auth';

// 300s (tetto massimo consentito su piattaforma): la prima passata dopo il
// deploy smaltisce tutto il pregresso mai riconciliato (fino a ~19k contatti
// CRM, di cui ~7.880 righe agenzia) più il ciclo di aggregati sui contatti
// appena agganciati — entrambe le passate sono loop sequenziali con più
// round-trip al DB ciascuna, condivisi ora nella stessa request. I run
// successivi lavorano solo sul residuo (righe non ancora agganciate, contatti
// già agganciati) e restano ben sotto la soglia; 60s bastava quando la route
// faceva solo syncCrmFromPlatform, non basta più col backlog iniziale della
// riconciliazione.
export const maxDuration = 300;

/**
 * Sync CRM ↔ piattaforma. Schedule cron Vercel: 1x/giorno (vercel.json).
 * Auth: bearer CRON_SECRET (Vercel Cron) OR sessione ADMIN_PIATTAFORMA.
 *
 * Due passate: prima si agganciano le righe della lista alle aziende
 * registrate (idempotente: chi è già agganciato non viene rivisto), poi si
 * aggiornano gli aggregati dei contatti agganciati.
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const riconciliazione = await riconciliaTutto();
  const result = await syncCrmFromPlatform();
  // Log strutturato a fine job: se un run viene troncato (timeout, crash,
  // redeploy a metà) è l'unico modo per capire a che punto si era arrivati
  // prima del tentativo successivo — il job è idempotente e ritentabile, ma
  // senza questo log un run parziale è indistinguibile da uno riuscito nei
  // log della piattaforma.
  console.log('[crm-sync]', { ...riconciliazione, ...result });
  return NextResponse.json({ ok: true, riconciliazione, ...result });
}

export const GET = run;
export const POST = run;
