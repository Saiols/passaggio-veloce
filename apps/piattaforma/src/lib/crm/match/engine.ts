import 'server-only';
import { prisma } from '@pv/db';
import { identitaDaCompany, type CompanyGrezza } from './identita';
import { preparaContatto } from './score';
import { assegna, chiaveDaCoppia, chiaveIdentita } from './assign';
import type { SorgenteArricchimento } from './arricchimento';

/**
 * Calcolo delle proposte di aggancio (DRY-RUN: non scrive nulla).
 *
 * Tre letture: le aziende con le loro sedi, le identità già coperte (per non
 * riassegnare ciò che è già agganciato → idempotenza) e i contatti candidati,
 * cioè i lead liberi con almeno una chiave forte valorizzata.
 */

export type Proposta = {
  contactId: string;
  contactNome: string;
  contactTel: string | null;
  contactCitta: string | null;
  companyId: string;
  companyNome: string;
  sedeId: string | null;
  sedeNome: string | null;
  cat: 'BROKER' | 'AGENZIA';
  punteggio: number;
  campi: string[];
  /**
   * Data reale di registrazione dell'identità agganciata: `createdAt` della
   * sede per un match su sede, della madre per un match sulla madre. Finisce
   * in `iscrizioneAt` (apply.ts): usare il createdAt della madre anche per le
   * sedi faceva dire al campo una data che non è quella di quel punto vendita.
   */
  registrataAt: Date;
  /**
   * Anagrafica dell'identità agganciata, per l'arricchimento del contatto
   * (lib/crm/match/arricchimento.ts). Viaggia con la proposta perché qui
   * company e sedi sono già in memoria: farla rileggere ad `apply.ts`
   * significherebbe una query in più per ogni aggancio.
   */
  sorgente: SorgenteArricchimento;
  /** Ex aequo: vedi `Coppia.ambigua` in assign.ts. */
  ambigua: boolean;
};

const SELECT_COMPANY = {
  id: true,
  type: true,
  ragioneSociale: true,
  partitaIva: true,
  email: true,
  pec: true,
  telefono: true,
  indirizzo: true,
  civico: true,
  citta: true,
  cap: true,
  provincia: true,
  createdAt: true,
  sedi: {
    where: { deletedAt: null },
    select: {
      id: true,
      type: true,
      nome: true,
      telefono: true,
      email: true,
      indirizzo: true,
      civico: true,
      citta: true,
      cap: true,
      provincia: true,
      createdAt: true,
    },
  },
} as const;

export async function calcolaProposte(
  opts: { companyId?: string } = {},
): Promise<Proposta[]> {
  const companies = (await prisma.company.findMany({
    where: {
      deletedAt: null,
      ...(opts.companyId ? { id: opts.companyId } : {}),
    },
    select: SELECT_COMPANY,
  })) as unknown as CompanyGrezza[];
  if (companies.length === 0) return [];

  const agganciati = await prisma.crmContact.findMany({
    where: { deletedAt: null, companyId: { not: null } },
    select: { companyId: true, sedeId: true },
  });
  const coperte = new Set(agganciati.map((a) => chiaveDaCoppia(a)));

  const identita = companies
    .flatMap(identitaDaCompany)
    .filter((i) => !coperte.has(chiaveIdentita(i)));
  if (identita.length === 0) return [];

  const grezzi = await prisma.crmContact.findMany({
    where: {
      deletedAt: null,
      companyId: null,
      OR: [
        { telNorm: { not: null } },
        { waNorm: { not: null } },
        { emailNorm: { not: null } },
        { pivaNorm: { not: null } },
      ],
    },
    select: {
      id: true,
      cat: true,
      nome: true,
      tel: true,
      indirizzo: true,
      citta: true,
      cap: true,
      telNorm: true,
      waNorm: true,
      emailNorm: true,
      pivaNorm: true,
      createdAt: true,
    },
  });
  if (grezzi.length === 0) return [];

  const contatti = grezzi.map(preparaContatto);
  const coppie = assegna(identita, contatti);

  const nomeCompany = new Map(companies.map((c) => [c.id, c.ragioneSociale]));
  const nomeSede = new Map(
    companies.flatMap((c) => c.sedi.map((s) => [s.id, s.nome] as const)),
  );
  const perCompany = new Map(companies.map((c) => [c.id, c]));
  const perSede = new Map(
    companies.flatMap((c) => c.sedi.map((s) => [s.id, s] as const)),
  );

  return coppie.map((co) => {
    // `co.identita.companyId` viene sempre da `identita`, che è costruita
    // proprio da `companies` (identitaDaCompany) — la stessa lista da cui
    // `perCompany` è indicizzata: la company DEVE esserci. Un `!` nudo qui
    // farebbe passare `undefined` a `calcolaArricchimento` in apply.ts, che
    // lo incontrerebbe DENTRO il try/catch proprio dell'arricchimento
    // (review giro 1/5, Finding 3): l'errore finirebbe inghiottito in un
    // solo log per-contatto invece che fermare la passata, e la causa reale
    // — l'invariante rotta nel motore — resterebbe nascosta. Se dovesse mai
    // succedere è un bug qui, non un dato mancante: deve esplodere a monte.
    const company = perCompany.get(co.identita.companyId);
    if (!company) {
      throw new Error(
        `[calcolaProposte] invariante rotta: company ${co.identita.companyId} assente da perCompany`,
      );
    }
    return {
      contactId: co.contatto.id,
      contactNome: co.contatto.nome,
      contactTel: co.contatto.tel,
      contactCitta: co.contatto.citta,
      companyId: co.identita.companyId,
      companyNome: nomeCompany.get(co.identita.companyId) ?? '—',
      sedeId: co.identita.sedeId,
      sedeNome: co.identita.sedeId ? (nomeSede.get(co.identita.sedeId) ?? null) : null,
      cat: co.identita.cat,
      punteggio: co.punteggio,
      campi: co.campi,
      registrataAt: co.identita.registrataAt,
      sorgente: {
        company,
        sede: co.identita.sedeId ? (perSede.get(co.identita.sedeId) ?? null) : null,
      },
      ambigua: co.ambigua,
    };
  });
}
