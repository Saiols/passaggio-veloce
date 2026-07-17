import 'server-only';
import { prisma } from '@pv/db';
import {
  giorniRimanenti as calcRimanenti,
  giorniTrascorsi as calcTrascorsi,
  isInPreavviso,
  isVisuraScaduta,
} from './validita';

export type StatoVisura = {
  /** ESENTE = nessuna data nota → mai preavviso, mai blocco. */
  stato: 'OK' | 'PREAVVISO' | 'SCADUTA' | 'ESENTE';
  dataEmissione: Date | null;
  giorniTrascorsi: number | null;
  giorniRimanenti: number | null;
};

/**
 * Stato della visura di un'azienda (madre). Derivato da `Company.visuraCameraleData`
 * + `now`: nessun flag persistito, quindi non può disallinearsi dalla realtà e lo
 * sblocco è automatico appena la data cambia.
 *
 * Multi-sede: la visura sta sulla MADRE (P.IVA unica) → lo stato vale per tutte le
 * sue sedi. `companyId` è sempre l'id della madre.
 *
 * `null` (azienda inesistente o `visuraCameraleData` non valorizzata) → ESENTE,
 * mai bloccata: è strutturale, la colonna si popola solo se il gate KYC passa.
 */
export async function getStatoVisura(companyId: string, now: Date = new Date()): Promise<StatoVisura> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { visuraCameraleData: true },
  });
  const dataEmissione = company?.visuraCameraleData ?? null;
  if (!dataEmissione) {
    return { stato: 'ESENTE', dataEmissione: null, giorniTrascorsi: null, giorniRimanenti: null };
  }

  const trascorsi = calcTrascorsi(dataEmissione, now);
  const rimanenti = calcRimanenti(dataEmissione, now);
  const stato = isVisuraScaduta(dataEmissione, now)
    ? 'SCADUTA'
    : isInPreavviso(dataEmissione, now)
      ? 'PREAVVISO'
      : 'OK';

  return { stato, dataEmissione, giorniTrascorsi: trascorsi, giorniRimanenti: rimanenti };
}

/**
 * Helper per le guard (payout broker, operatività agenzia): true SOLO se
 * effettivamente scaduta. ESENTE (null) e PREAVVISO → false, mai bloccata.
 */
export async function isVisuraScadutaCompany(companyId: string, now: Date = new Date()): Promise<boolean> {
  const { stato } = await getStatoVisura(companyId, now);
  return stato === 'SCADUTA';
}
