import { NextResponse, type NextRequest } from 'next/server';
import { syncCrmFromPlatform } from '@/lib/crm/sync';
import { riconciliaTutto } from '@/lib/crm/match/apply';
import { requireAdminOrCron } from '@/lib/jobs/auth';

// 300s (tetto massimo consentito su piattaforma): la prima passata dopo il
// deploy smaltisce tutto il pregresso mai riconciliato (fino a ~19k contatti
// CRM, di cui ~7.880 righe agenzia) più il ciclo di aggregati sui contatti
// appena agganciati — entrambe le passate sono loop sequenziali con più
// round-trip al DB ciascuna, condivisi ora nella stessa request. È una
// decisione operativa deliberata, non un dettaglio implementativo:
// riportarlo a 60 riapre esattamente il rischio di timeout sul primo run in
// produzione. I run successivi lavorano solo sul residuo e restano ben
// sotto la soglia.
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
  // Solo le proposte NON ambigue: qui non c'è nessuno che guarda. Le ambigue
  // (ex aequo di punteggio, spareggio arbitrario nel merito) restano alla
  // pagina admin e vengono contate in `ambigueSaltate`, che finisce nel log
  // qui sotto — una passata incompleta si deve vedere.
  const riconciliazione = await riconciliaTutto();
  // Log subito dopo la prima passata, PRIMA di avviare gli aggregati: il
  // ciclo per-contatto di syncCrmFromPlatform (migliaia di iterazioni al
  // primo run) è il punto più a rischio di sforare maxDuration. Un log
  // messo solo a fine funzione non verrebbe mai scritto se il job viene
  // troncato lì — questa riga invece resta agli atti anche in quel caso,
  // ed è l'informazione che serve per capire dove si era arrivati.
  console.log('[crm-sync] riconciliazione', riconciliazione);
  const result = await syncCrmFromPlatform();
  // Log finale: solo per il caso completo, ricapitola anche gli aggregati.
  // `riconciliazione` e `result` hanno ENTRAMBI una chiave `arricchiti`
  // (contatti arricchiti in fase di aggancio vs. già agganciati): uno spread
  // piatto fa vincere silenziosamente il secondo sul primo. Qui restano
  // annidati per non perdere nessuno dei due numeri.
  console.log('[crm-sync] completato', { riconciliazione, ...result });
  return NextResponse.json({ ok: true, riconciliazione, ...result });
}

export const GET = run;
export const POST = run;
