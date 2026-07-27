/**
 * Da un'azienda registrata alle sue "identità" confrontabili con la lista CRM.
 * Modulo PURO.
 *
 * La lista è fatta di punti vendita: è la SEDE che assomiglia alla riga, non
 * l'azienda madre. Ogni sede è quindi un'identità a sé (spec D3) e può
 * agganciare una riga diversa; il contatto resta comunque legato alla madre
 * via `companyId`, con `sedeId` a dire quale sede ha fatto match.
 */
import {
  normalizeTel,
  normalizeEmail,
  normalizePiva,
  normalizeNome,
  normalizeIndirizzo,
  normalizeCitta,
  normalizeCap,
} from './normalize';

export type CatIdentita = 'BROKER' | 'AGENZIA';

export type SedeGrezza = {
  id: string;
  type: 'DEALER' | 'AGENZIA';
  nome: string;
  telefono: string | null;
  email: string | null;
  indirizzo: string;
  civico: string | null;
  citta: string;
  cap: string;
  createdAt: Date;
};

export type CompanyGrezza = {
  id: string;
  type: 'DEALER' | 'AGENZIA';
  ragioneSociale: string;
  partitaIva: string;
  email: string;
  pec: string;
  telefono: string | null;
  indirizzo: string;
  civico: string | null;
  citta: string;
  cap: string;
  createdAt: Date;
  sedi: SedeGrezza[];
};

export type Identita = {
  companyId: string;
  sedeId: string | null;
  cat: CatIdentita;
  telKeys: string[];
  emailKeys: string[];
  pivaKeys: string[];
  nomeKeys: string[];
  indirizzoKey: string;
  cittaKey: string;
  capKey: string;
  registrataAt: Date;
};

/**
 * DEALER → BROKER, AGENZIA → AGENZIA. Esportata perché è anche la regola che
 * decide su quale colonna contare le pratiche di un'azienda (`brokerId` vs
 * `agenziaAssegnataId`): deve esistere in un posto solo.
 */
export const catDaType = (t: 'DEALER' | 'AGENZIA'): CatIdentita =>
  t === 'AGENZIA' ? 'AGENZIA' : 'BROKER';

/** Toglie i vuoti e i duplicati: una chiave vuota non deve mai fare match. */
const chiavi = (...valori: string[]): string[] =>
  [...new Set(valori.filter((v) => v !== ''))];

export function identitaDaCompany(c: CompanyGrezza): Identita[] {
  const pivaKeys = chiavi(normalizePiva(c.partitaIva));
  const nomeMadre = normalizeNome(c.ragioneSociale);

  const madre: Identita = {
    companyId: c.id,
    sedeId: null,
    cat: catDaType(c.type),
    telKeys: chiavi(normalizeTel(c.telefono)),
    emailKeys: chiavi(normalizeEmail(c.email), normalizeEmail(c.pec)),
    pivaKeys,
    nomeKeys: chiavi(nomeMadre),
    indirizzoKey: normalizeIndirizzo(c.indirizzo),
    cittaKey: normalizeCitta(c.citta),
    capKey: normalizeCap(c.cap),
    registrataAt: c.createdAt,
  };

  const sedi = c.sedi.map(
    (s): Identita => ({
      companyId: c.id,
      sedeId: s.id,
      cat: catDaType(s.type),
      telKeys: chiavi(normalizeTel(s.telefono)),
      emailKeys: chiavi(normalizeEmail(s.email)),
      pivaKeys,
      // Il punto vendita in lista può portare l'insegna della madre.
      nomeKeys: chiavi(normalizeNome(s.nome), nomeMadre),
      indirizzoKey: normalizeIndirizzo(s.indirizzo),
      cittaKey: normalizeCitta(s.citta),
      capKey: normalizeCap(s.cap),
      registrataAt: s.createdAt,
    }),
  );

  return [madre, ...sedi];
}
