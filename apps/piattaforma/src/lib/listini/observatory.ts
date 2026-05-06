import 'server-only';
import { prisma } from '@pv/db';

/**
 * Engine Osservatorio Prezzi (FASE 8).
 *
 * Aggregazioni statistiche dei listini agenzie per provincia: media,
 * minimo, massimo, numero di listini considerati. Usato per:
 *  - Benchmark "tu vs media zona" sulla dashboard agenzia
 *  - Dashboard admin osservatorio
 */

export type StatPrezzo = {
  count: number;
  mediaCent: number;
  minCent: number;
  maxCent: number;
};

export type ProvinciaStat = {
  provincia: string;
  trapasso: StatPrezzo | null;
  minivoltura: StatPrezzo | null;
};

function aggregate(values: number[]): StatPrezzo | null {
  const filtered = values.filter((v) => v > 0);
  if (filtered.length === 0) return null;
  const sum = filtered.reduce((s, v) => s + v, 0);
  return {
    count: filtered.length,
    mediaCent: Math.round(sum / filtered.length),
    minCent: Math.min(...filtered),
    maxCent: Math.max(...filtered),
  };
}

/**
 * Statistiche prezzi per una specifica provincia.
 * Considera solo i listini in formato FORM_STRUTTURATO che dichiarano
 * copertura della provincia.
 */
export async function statsForProvincia(
  provincia: string,
): Promise<ProvinciaStat> {
  const prov = provincia.toUpperCase();
  const listini = await prisma.listino.findMany({
    where: {
      formato: 'FORM_STRUTTURATO',
      provincieCopertura: { has: prov },
      agenzia: { deletedAt: null, suspendedAt: null },
    },
    select: {
      prezzoBaseTrapassoCent: true,
      prezzoMinivolturaCent: true,
    },
  });

  return {
    provincia: prov,
    trapasso: aggregate(
      listini
        .map((l) => l.prezzoBaseTrapassoCent ?? 0)
        .filter((v) => v > 0),
    ),
    minivoltura: aggregate(
      listini
        .map((l) => l.prezzoMinivolturaCent ?? 0)
        .filter((v) => v > 0),
    ),
  };
}

/**
 * Statistiche aggregate per TUTTE le province coperte. Usato dalla
 * dashboard admin per la tabella osservatorio.
 */
export async function statsAllProvincie(): Promise<ProvinciaStat[]> {
  const listini = await prisma.listino.findMany({
    where: {
      formato: 'FORM_STRUTTURATO',
      agenzia: { deletedAt: null, suspendedAt: null },
    },
    select: {
      prezzoBaseTrapassoCent: true,
      prezzoMinivolturaCent: true,
      provincieCopertura: true,
    },
  });

  // Per ogni provincia coperta, raccogli i valori
  const byProv = new Map<
    string,
    { trapasso: number[]; minivoltura: number[] }
  >();
  for (const l of listini) {
    for (const p of l.provincieCopertura) {
      const e = byProv.get(p) ?? { trapasso: [], minivoltura: [] };
      if (l.prezzoBaseTrapassoCent && l.prezzoBaseTrapassoCent > 0) {
        e.trapasso.push(l.prezzoBaseTrapassoCent);
      }
      if (l.prezzoMinivolturaCent && l.prezzoMinivolturaCent > 0) {
        e.minivoltura.push(l.prezzoMinivolturaCent);
      }
      byProv.set(p, e);
    }
  }

  const result: ProvinciaStat[] = [];
  for (const [p, e] of byProv.entries()) {
    result.push({
      provincia: p,
      trapasso: aggregate(e.trapasso),
      minivoltura: aggregate(e.minivoltura),
    });
  }
  result.sort((a, b) => a.provincia.localeCompare(b.provincia));
  return result;
}

/**
 * Confronto del listino dell'agenzia rispetto alla media di una provincia.
 * Usato per il banner benchmark sulla dashboard agenzia.
 */
export type Benchmark = {
  miei: { trapasso: number | null; minivoltura: number | null };
  media: { trapasso: number | null; minivoltura: number | null };
  delta: { trapasso: number | null; minivoltura: number | null };
};

export async function getBenchmarkForAgenzia(
  agenziaId: string,
): Promise<Benchmark | null> {
  const listino = await prisma.listino.findFirst({
    where: { agenziaId, formato: 'FORM_STRUTTURATO' },
    select: {
      prezzoBaseTrapassoCent: true,
      prezzoMinivolturaCent: true,
      provincieCopertura: true,
    },
  });
  if (!listino) return null;
  const provPrincipale = listino.provincieCopertura[0];
  if (!provPrincipale) return null;

  const stats = await statsForProvincia(provPrincipale);
  const trapassoMio = listino.prezzoBaseTrapassoCent ?? null;
  const minivoltMio = listino.prezzoMinivolturaCent ?? null;
  const trapassoMed = stats.trapasso?.mediaCent ?? null;
  const minivoltMed = stats.minivoltura?.mediaCent ?? null;

  return {
    miei: { trapasso: trapassoMio, minivoltura: minivoltMio },
    media: { trapasso: trapassoMed, minivoltura: minivoltMed },
    delta: {
      trapasso:
        trapassoMio !== null && trapassoMed !== null
          ? trapassoMio - trapassoMed
          : null,
      minivoltura:
        minivoltMio !== null && minivoltMed !== null
          ? minivoltMio - minivoltMed
          : null,
    },
  };
}
