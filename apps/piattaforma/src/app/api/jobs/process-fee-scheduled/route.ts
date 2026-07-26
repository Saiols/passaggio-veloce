import { NextResponse, type NextRequest } from 'next/server';
import { processFeeScheduled } from '@/lib/jobs/process-fee-scheduled';
import { riconciliaFattureIncassate } from '@/lib/jobs/riconcilia-fatture';
import { requireAdminOrCron } from '@/lib/jobs/auth';

/**
 * 300s (il tetto della piattaforma), non i 60 di default: questa singola
 * richiesta fa reaper + fino a 30 `chargeFee` (ognuno un round-trip Stripe che
 * su SUCCESS genera fattura, PDF ed email) + fino a 30 emissioni e 30 N53 di
 * riconciliazione, di nuovo con PDF e invii. Il caso in cui serve davvero è il
 * recupero dopo un'ora di downtime — cioè esattamente quello in cui 60 secondi
 * non bastano e il timeout tronca la passata DOPO aver addebitato e PRIMA di
 * aver fatturato.
 */
export const maxDuration = 300;

/**
 * Rete di recupero degli addebiti: l'addebito normale parte dalla firma
 * (firma-engine.ts). Qui restano il reaper, i retry orfani e i fee la cui
 * chiamata dalla firma non è mai partita. Schedule cron Vercel: ogni ora.
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  const result = await processFeeScheduled();
  // Stessa passata: gli incassi appena chiusi qui sopra sono già coperti dal
  // percorso normale, questa raccoglie quelli rimasti indietro.
  const riconciliazione = await riconciliaFattureIncassate();
  return NextResponse.json({ ok: true, ...result, ...riconciliazione });
}

export const GET = run;
export const POST = run;
