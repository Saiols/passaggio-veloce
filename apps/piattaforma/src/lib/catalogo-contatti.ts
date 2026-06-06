import 'server-only';
import { prisma } from '@pv/db';

export type Contatto = {
  /** chiave di deduplicazione: email | telefono | CF | PIVA */
  key: string;
  ruolo: 'VENDITORE' | 'ACQUIRENTE';
  nominativo: string;
  isPersonaGiuridica: boolean;
  email: string | null;
  telefono: string | null;
  identificativoFiscale: string | null;
  numeroPratiche: number;
  ultimoVistoAt: Date;
};

type RawContact = {
  ruolo: 'VENDITORE' | 'ACQUIRENTE';
  isPG: boolean;
  nome: string | null;
  cognome: string | null;
  ragioneSociale: string | null;
  cf: string | null;
  piva: string | null;
  telefono: string | null;
  email: string | null;
  praticaCreatedAt: Date;
};

function normalize(s: string | null): string {
  return (s ?? '').trim().toLowerCase();
}

function dedupKey(c: RawContact): string | null {
  if (c.email) return `email:${normalize(c.email)}`;
  if (c.telefono) return `tel:${normalize(c.telefono).replace(/\s+/g, '')}`;
  if (c.cf) return `cf:${normalize(c.cf)}`;
  if (c.piva) return `piva:${normalize(c.piva)}`;
  return null; // skip senza identificativo
}

function nominativo(c: RawContact): string {
  if (c.isPG) return c.ragioneSociale?.trim() || '—';
  return `${c.nome ?? ''} ${c.cognome ?? ''}`.trim() || '—';
}

/**
 * Catalogo contatti aggregato (F-05). Estrae venditore/acquirente da tutte le
 * pratiche non eliminate, deduplica per email/telefono/CF/PIVA, conta quante
 * pratiche per contatto e tiene la data più recente.
 */
export async function buildCatalogoContatti(filtroQuery?: string): Promise<Contatto[]> {
  const pratiche = await prisma.pratica.findMany({
    where: { deletedAt: null },
    select: {
      createdAt: true,
      venditori: {
        orderBy: { ordine: 'asc' },
        select: {
          isPersonaGiuridica: true,
          nome: true,
          cognome: true,
          ragioneSociale: true,
          cf: true,
          piva: true,
          telefono: true,
          email: true,
        },
      },
      acquirenteIsPersonaGiuridica: true,
      acquirenteNome: true,
      acquirenteCognome: true,
      acquirenteRagioneSociale: true,
      acquirenteCF: true,
      acquirentePIVA: true,
      acquirenteTelefono: true,
      acquirenteEmail: true,
    },
  });

  const raw: RawContact[] = [];
  for (const p of pratiche) {
    for (const v of p.venditori) {
      raw.push({
        ruolo: 'VENDITORE',
        isPG: v.isPersonaGiuridica,
        nome: v.nome,
        cognome: v.cognome,
        ragioneSociale: v.ragioneSociale,
        cf: v.cf,
        piva: v.piva,
        telefono: v.telefono,
        email: v.email,
        praticaCreatedAt: p.createdAt,
      });
    }
    raw.push({
      ruolo: 'ACQUIRENTE',
      isPG: p.acquirenteIsPersonaGiuridica,
      nome: p.acquirenteNome,
      cognome: p.acquirenteCognome,
      ragioneSociale: p.acquirenteRagioneSociale,
      cf: p.acquirenteCF,
      piva: p.acquirentePIVA,
      telefono: p.acquirenteTelefono,
      email: p.acquirenteEmail,
      praticaCreatedAt: p.createdAt,
    });
  }

  const byKey = new Map<string, Contatto>();
  for (const r of raw) {
    const key = dedupKey(r);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.numeroPratiche += 1;
      if (r.praticaCreatedAt > existing.ultimoVistoAt) {
        existing.ultimoVistoAt = r.praticaCreatedAt;
      }
      // mantieni il valore più "ricco" se l'esistente è incompleto
      existing.email = existing.email ?? r.email;
      existing.telefono = existing.telefono ?? r.telefono;
    } else {
      byKey.set(key, {
        key,
        ruolo: r.ruolo,
        nominativo: nominativo(r),
        isPersonaGiuridica: r.isPG,
        email: r.email,
        telefono: r.telefono,
        identificativoFiscale: r.isPG ? r.piva : r.cf,
        numeroPratiche: 1,
        ultimoVistoAt: r.praticaCreatedAt,
      });
    }
  }

  let result = [...byKey.values()];
  if (filtroQuery) {
    const q = filtroQuery.toLowerCase();
    result = result.filter(
      (c) =>
        c.nominativo.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.telefono?.toLowerCase().includes(q) ||
        c.identificativoFiscale?.toLowerCase().includes(q),
    );
  }
  result.sort((a, b) => b.ultimoVistoAt.getTime() - a.ultimoVistoAt.getTime());
  return result;
}
