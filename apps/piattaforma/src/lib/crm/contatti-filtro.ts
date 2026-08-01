import { Prisma } from '@pv/db';
import { sogliaRichiamoDovuto } from '@/lib/crm/richiamo';
import { regioneVarianti } from '@/lib/crm/regione';

/**
 * Descrizione serializzabile dei filtri della lista contatti. Fonte unica del
 * `where` Prisma per la lista (`page.tsx`) e per l'eliminazione massiva
 * "per filtro" (`bulkHardDeleteCrmContactsAction`): non devono divergere.
 *
 * `adesso` è ISO perché il preset "richiamo" dipende dal giorno romano corrente;
 * `soloAssegnatoAId` è lo scoping SALES (vince sul filtro `assegnatoA`).
 */
export interface FiltroContatti {
  q?: string;
  cat?: 'BROKER' | 'AGENZIA' | '';
  status?: string;
  regione?: string;
  assegnatoA?: string;
  preset?: 'urgenti' | 'richiamo' | '';
  soloAssegnatoAId?: string;
  adesso: string;
}

export function whereContatti(f: FiltroContatti): Prisma.CrmContactWhereInput {
  const where: Prisma.CrmContactWhereInput = { deletedAt: null };

  if (f.q) {
    const q = f.q.trim();
    where.OR = [
      { nome: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { citta: { contains: q, mode: 'insensitive' } },
      { tel: { contains: q } },
    ];
  }
  if (f.cat) where.cat = f.cat;
  if (f.regione) where.regione = { in: regioneVarianti(f.regione) };
  if (f.assegnatoA) where.assignedToId = f.assegnatoA;

  if (f.preset === 'urgenti') {
    // "Da lavorare": traguardi fattuali caldi OPPURE giudizio Interessato
    // (l'interesse ora vive su `giudizio`, non più su status S3).
    where.AND = [{ OR: [{ status: { in: ['S6', 'S5', 'S4'] } }, { giudizio: 'INTERESSATO' }] }];
  } else if (f.preset === 'richiamo') {
    // Il richiamo è un asse indipendente da status: chi ha un `nextContactAt`
    // dovuto e non si è ancora registrato. La soglia è la fine del giorno romano.
    where.iscrizioneComp = false;
    where.nextContactAt = { not: null, lte: sogliaRichiamoDovuto(new Date(f.adesso)) };
  } else if (f.status) {
    where.status = f.status as Prisma.CrmContactWhereInput['status'];
  }

  // Lo scoping SALES vince su qualsiasi filtro assegnatario.
  if (f.soloAssegnatoAId) where.assignedToId = f.soloAssegnatoAId;

  return where;
}
