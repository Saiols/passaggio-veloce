import 'server-only';
import { prisma } from '@pv/db';
import { geocodeAddress } from './geocode';

/**
 * Geocoda best-effort le sedi non ancora geolocalizzate (lat null) di una
 * company. Usata post-commit in registrazione: mai dentro una transazione
 * (fa chiamate di rete). Non lancia: un fallimento lascia la sede senza
 * coordinate, che il backfill riprenderà.
 */
export async function geocodeCompanySedi(companyId: string): Promise<void> {
  try {
    const sedi = await prisma.sede.findMany({
      where: { companyId, lat: null, deletedAt: null },
      select: { id: true, indirizzo: true, civico: true, citta: true, cap: true, provincia: true },
    });
    for (const s of sedi) {
      const coords = await geocodeAddress(s);
      if (!coords) continue;
      await prisma.sede.update({
        where: { id: s.id },
        data: { lat: coords.lat, lng: coords.lng, geocodedAt: new Date() },
      });
    }
  } catch (e) {
    console.warn('[geocode] geocodeCompanySedi fallito', (e as Error).message);
  }
}
