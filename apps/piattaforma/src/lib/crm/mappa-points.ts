import 'server-only';
import { prisma } from '@pv/db';

export type MappaPoint = {
  id: string;
  type: 'DEALER' | 'AGENZIA';
  lat: number;
  lng: number;
  nome: string;
  citta: string;
  provincia: string;
};

export type MappaData = {
  points: MappaPoint[];
  nonGeolocalizzate: number;
};

/**
 * Punti per la mappa CRM: una Sede = un punto. Solo aziende iscritte
 * (Sede non cancellata, Company madre non cancellata) con coordinate valide.
 * Ritorna anche quante sedi restano senza coordinate (per la nota in pagina).
 */
export async function getMappaPoints(): Promise<MappaData> {
  const [rows, nonGeolocalizzate] = await Promise.all([
    prisma.sede.findMany({
      where: {
        deletedAt: null,
        lat: { not: null },
        lng: { not: null },
        company: { deletedAt: null },
      },
      select: {
        id: true, type: true, lat: true, lng: true,
        nome: true, citta: true, provincia: true,
      },
    }),
    prisma.sede.count({
      where: { deletedAt: null, lat: null, company: { deletedAt: null } },
    }),
  ]);

  const points: MappaPoint[] = [];
  for (const r of rows) {
    if (r.lat == null || r.lng == null) continue; // guard: il where già filtra
    points.push({
      id: r.id,
      type: r.type as 'DEALER' | 'AGENZIA',
      lat: r.lat,
      lng: r.lng,
      nome: r.nome,
      citta: r.citta,
      provincia: r.provincia,
    });
  }

  return { points, nonGeolocalizzate };
}
