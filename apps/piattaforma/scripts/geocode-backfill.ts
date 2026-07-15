/**
 * Backfill coordinate sedi: geocoda tutte le Sede con lat null e le aggiorna.
 * Idempotente (rieseguibile: salta chi ha già lat). Rate-limited. Logga gli
 * esiti — i falliti restano lat null e verranno ritentati alla prossima run.
 *
 * Uso: pnpm --filter piattaforma exec tsx scripts/geocode-backfill.ts
 * Richiede NEXT_PUBLIC_GOOGLE_MAPS_API_KEY nell'ambiente.
 */
import { prisma } from '@pv/db';
import { geocodeAddress } from '../src/lib/geo/geocode-core';

const SLEEP_MS = 120; // ~8 req/s, sotto i limiti Google

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const sedi = await prisma.sede.findMany({
    where: { lat: null, deletedAt: null },
    select: { id: true, nome: true, indirizzo: true, civico: true, citta: true, cap: true, provincia: true },
  });
  console.log(`[backfill] ${sedi.length} sedi da geocodare`);

  let ok = 0;
  let ko = 0;
  for (const s of sedi) {
    const coords = await geocodeAddress(s);
    if (coords) {
      await prisma.sede.update({
        where: { id: s.id },
        data: { lat: coords.lat, lng: coords.lng, geocodedAt: new Date() },
      });
      ok++;
    } else {
      ko++;
      console.warn(`[backfill] KO ${s.nome} — ${s.indirizzo} ${s.civico ?? ''} ${s.cap} ${s.citta} ${s.provincia}`);
    }
    await sleep(SLEEP_MS);
  }

  console.log(`[backfill] fatto: ${ok} geocodate, ${ko} fallite`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
