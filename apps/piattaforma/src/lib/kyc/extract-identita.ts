import { extractCi } from './extract-ci';
import { extractCf } from './extract-cf';

export type IdentitaTipo = 'CI' | 'PASSAPORTO' | 'PATENTE';
export type IdentitaData = { nome?: string; cognome?: string; codiceFiscale?: string };

/** MRZ TD3 (passaporto): riga 1 "P<ISOSURNAME<<GIVEN<NAMES<<<". */
function parsePassaporto(text: string): IdentitaData {
  const up = text.toUpperCase().replace(/\s/g, '');
  const m = /P[<A-Z][A-Z]{3}([A-Z]+(?:<[A-Z]+)*)<<([A-Z]+(?:<[A-Z]+)*)/.exec(up);
  if (!m) return {};
  const cognome = m[1]!.replace(/</g, ' ').trim();
  const nome = m[2]!.replace(/</g, ' ').trim();
  return { cognome: cognome || undefined, nome: nome || undefined };
}

/** Patente: campi numerati "1. COGNOME" / "2. NOME". */
function parsePatente(text: string): IdentitaData {
  const cogn = /(?:^|\n)\s*1\.?\s*([A-ZÀ-Ù'' ]{2,})/i.exec(text);
  const nome = /(?:^|\n)\s*2\.?\s*([A-ZÀ-Ù'' ]{2,})/i.exec(text);
  return {
    cognome: cogn?.[1]?.trim().toUpperCase(),
    nome: nome?.[1]?.trim().toUpperCase(),
  };
}

export function extractIdentita(text: string, tipo: IdentitaTipo): IdentitaData {
  if (tipo === 'CI') {
    const ci = extractCi(text);
    const cf = extractCf(text);
    return { nome: ci.nome, cognome: ci.cognome, codiceFiscale: cf.codiceFiscale };
  }
  if (tipo === 'PASSAPORTO') return parsePassaporto(text);
  return parsePatente(text);
}
