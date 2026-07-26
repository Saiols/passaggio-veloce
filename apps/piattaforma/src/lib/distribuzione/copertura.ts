import 'server-only';
import { prisma } from '@pv/db';
import { distanceKm } from '@/lib/geo/coords';
import { isVisuraScaduta } from '@/lib/visura/validita';
import { getDistribuzioneConfig } from './config';

export const MOTIVI_ESCLUSIONE = [
  'REVOCATA_ADMIN',
  'SEDE_SOSPESA',
  'AZIENDA_SOSPESA',
  'BLOCCO_PAGAMENTO',
  'VISURA_SCADUTA',
] as const;

export type MotivoEsclusione = (typeof MOTIVI_ESCLUSIONE)[number];

export type SedeCopertura = {
  sedeId: string;
  nome: string;
  citta: string;
  ragioneSociale: string;
  distanzaM: number;
  stato: 'contattata' | 'in-attesa' | 'esclusa';
  round: number | null;
  esito: string | null;
  motivo: MotivoEsclusione | null;
};

export type Copertura = {
  raggioMaxM: number;
  raggioCorrenteM: number | null;
  /** True se la pratica non ha coordinate: nessuna distanza è calcolabile. */
  origineMancante: boolean;
  sedi: SedeCopertura[];
  senzaCoordinate: { sedeId: string; nome: string; citta: string }[];
};

/** Etichetta italiana di un motivo, per la UI. */
export function labelMotivo(m: MotivoEsclusione): string {
  switch (m) {
    case 'REVOCATA_ADMIN':
      return 'esclusa dall’admin (revoca)';
    case 'SEDE_SOSPESA':
      return 'sede sospesa';
    case 'AZIENDA_SOSPESA':
      return 'azienda sospesa o eliminata';
    case 'BLOCCO_PAGAMENTO':
      return 'blocco pagamento attivo';
    case 'VISURA_SCADUTA':
      return 'visura camerale scaduta';
  }
}

/**
 * Perché una pratica è (o non è) arrivata a ciascuna agenzia in zona.
 *
 * Ripete la selezione di `candidatiEntro` **senza i filtri di idoneità**, che
 * nel motore escludono in silenzio: coordinate mancanti, visura scaduta,
 * sospensioni e blocco pagamento fanno sparire una sede senza lasciare traccia
 * da nessuna parte. Qui diventano un motivo leggibile.
 *
 * Diagnostica admin-only: nessun dato di questa funzione va mostrato a broker o
 * agenzie.
 */
export async function getCoperturaPratica(praticaId: string): Promise<Copertura | null> {
  const [cfg, pratica] = await Promise.all([
    getDistribuzioneConfig(),
    prisma.pratica.findUnique({
      where: { id: praticaId },
      select: {
        id: true,
        lat: true,
        lng: true,
        raggioCorrenteM: true,
        distribuzioneCiclo: true,
        assegnazioni: { select: { sedeId: true, ciclo: true, round: true, esito: true } },
      },
    }),
  ]);
  if (!pratica) return null;

  const base: Copertura = {
    raggioMaxM: cfg.raggioMaxM,
    raggioCorrenteM: pratica.raggioCorrenteM ?? null,
    origineMancante: pratica.lat == null || pratica.lng == null,
    sedi: [],
    senzaCoordinate: [],
  };
  if (pratica.lat == null || pratica.lng == null) return base;
  const origine = { lat: pratica.lat, lng: pratica.lng };

  // Nessun filtro di idoneità: solo le sedi agenzia non cancellate.
  const sedi = await prisma.sede.findMany({
    where: { type: 'AGENZIA', deletedAt: null },
    select: {
      id: true,
      nome: true,
      citta: true,
      lat: true,
      lng: true,
      suspendedAt: true,
      company: {
        select: {
          ragioneSociale: true,
          deletedAt: true,
          suspendedAt: true,
          bloccoPagamentoAt: true,
          visuraCameraleData: true,
        },
      },
    },
  });

  const now = new Date();

  // Una sede può avere PIÙ righe di assegnazione sulla stessa pratica: il
  // vincolo unico è su (praticaId, sedeId, round, ciclo), non su sedeId da
  // solo. È lo scenario reale del ricircolo dopo revoca (`sediDaEscludere`):
  // una riga del ciclo vecchio (es. ASSEGNATA_ALTRO) convive con una riga del
  // ciclo corrente per la stessa sede. Raggruppare in una lista — e NON
  // ridurre a "una riga per sede" — evita di dipendere dall'ordine con cui
  // Postgres/l'array le restituisce, che qui non è garantito.
  const perSede = new Map<string, typeof pratica.assegnazioni>();
  for (const a of pratica.assegnazioni) {
    if (a.sedeId == null) continue;
    const list = perSede.get(a.sedeId);
    if (list) list.push(a);
    else perSede.set(a.sedeId, [a]);
  }

  for (const s of sedi) {
    if (s.lat == null || s.lng == null) {
      base.senzaCoordinate.push({ sedeId: s.id, nome: s.nome, citta: s.citta });
      continue;
    }

    const distanzaM = Math.round(distanceKm(origine, { lat: s.lat, lng: s.lng }) * 1000);
    if (distanzaM > cfg.raggioMaxM) continue;

    const assList = perSede.get(s.id) ?? [];
    const comune = {
      sedeId: s.id,
      nome: s.nome,
      citta: s.citta,
      ragioneSociale: s.company.ragioneSociale,
      distanzaM,
    };

    // Criterio 1: la revoca admin è permanente e vale su QUALUNQUE ciclo — si
    // cerca in tutta la lista, non solo nell'ultima riga. Va valutata prima
    // del criterio "contattata", altrimenti una sede revocata (e poi
    // eventualmente ricontattata in un ciclo successivo) sembrerebbe solo
    // "contattata".
    if (assList.some((a) => a.esito === 'REVOCATA_ADMIN')) {
      base.sedi.push({ ...comune, stato: 'esclusa', round: null, esito: null, motivo: 'REVOCATA_ADMIN' });
      continue;
    }

    // Criterio 2: contattata nel ciclo CORRENTE. Se per qualche motivo esistono
    // più righe nello stesso ciclo (es. escalation manuale a round 99 sopra un
    // round normale), vince quella con il round più alto — il contatto più
    // recente — non quella che capita per ultima nell'array.
    const contattiCicloCorrente = assList.filter((a) => a.ciclo === pratica.distribuzioneCiclo);
    if (contattiCicloCorrente.length > 0) {
      const ultima = contattiCicloCorrente.reduce((max, a) => (a.round > max.round ? a : max));
      base.sedi.push({
        ...comune,
        stato: 'contattata',
        round: ultima.round,
        esito: ultima.esito,
        motivo: null,
      });
      continue;
    }

    const motivo = motivoEsclusione(s, now);
    base.sedi.push(
      motivo
        ? { ...comune, stato: 'esclusa', round: null, esito: null, motivo }
        : { ...comune, stato: 'in-attesa', round: null, esito: null, motivo: null },
    );
  }

  base.sedi.sort((a, b) => a.distanzaM - b.distanzaM);
  return base;
}

/** Primo motivo che rende la sede non candidabile, o null se è idonea. */
function motivoEsclusione(
  s: {
    suspendedAt: Date | null;
    company: {
      deletedAt: Date | null;
      suspendedAt: Date | null;
      bloccoPagamentoAt: Date | null;
      visuraCameraleData: Date | null;
    };
  },
  now: Date,
): MotivoEsclusione | null {
  if (s.suspendedAt) return 'SEDE_SOSPESA';
  if (s.company.deletedAt || s.company.suspendedAt) return 'AZIENDA_SOSPESA';
  if (s.company.bloccoPagamentoAt) return 'BLOCCO_PAGAMENTO';
  // `null` è esente: nessuna data, nessuna scadenza da affermare. Stessa regola
  // del ramo `{ visuraCameraleData: null }` nel where di `candidatiEntro`.
  if (isVisuraScaduta(s.company.visuraCameraleData, now)) return 'VISURA_SCADUTA';
  return null;
}
