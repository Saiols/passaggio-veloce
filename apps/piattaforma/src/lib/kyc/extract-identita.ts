import { extractCi } from './extract-ci';
import { extractCf } from './extract-cf';

export type IdentitaTipo = 'CI' | 'PASSAPORTO' | 'PATENTE';
export type IdentitaData = { nome?: string; cognome?: string; codiceFiscale?: string };

/** Riga di valore plausibile (nome/cognome) nella zona visiva: solo MAIUSCOLE,
 * così non intercetta etichette miste o la firma. */
const VIZ_NAME = /^[A-ZÀ-Ù'’]{2,}(?:[ '’-][A-ZÀ-Ù'’]+)*$/;

/** MRZ TD3 (passaporto): riga 1 "P<ISOSURNAME<<GIVEN<NAMES<<<". */
function parsePassaportoMrz(text: string): IdentitaData {
  const up = text.toUpperCase().replace(/\s/g, '');
  const m = /P[<A-Z][A-Z]{3}([A-Z]+(?:<[A-Z]+)*)<<([A-Z]+(?:<[A-Z]+)*)/.exec(up);
  if (!m) return {};
  const cognome = m[1]!.replace(/</g, ' ').trim();
  const nome = m[2]!.replace(/</g, ' ').trim();
  return { cognome: cognome || undefined, nome: nome || undefined };
}

/** Zona visiva (VIZ) del passaporto: etichette "Cognome … (1)" / "Nome … (2)"
 * col valore sulla riga successiva. Fallback quando la MRZ non è leggibile
 * (foto da telefono con MRZ tagliata o sfocata). */
function parsePassaportoViz(text: string): IdentitaData {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const valueAfter = (labelRe: RegExp): string | undefined => {
    const i = lines.findIndex((l) => labelRe.test(l));
    if (i === -1) return undefined;
    const next = lines[i + 1];
    return next && VIZ_NAME.test(next) ? next.toUpperCase() : undefined;
  };
  // "Cognome" (etichetta 1) viene prima di "Nome" (etichetta 2); l'ancoraggio a
  // inizio riga evita che "Cognome" venga preso per "Nome".
  return { cognome: valueAfter(/^Cognome\b/i), nome: valueAfter(/^Nome\b/i) };
}

/** Passaporto: MRZ primaria; se non espone entrambi i campi (MRZ illeggibile),
 * completa coi campi etichettati della zona visiva. */
function parsePassaporto(text: string): IdentitaData {
  const mrz = parsePassaportoMrz(text);
  if (mrz.cognome && mrz.nome) return mrz;
  const viz = parsePassaportoViz(text);
  return { cognome: mrz.cognome ?? viz.cognome, nome: mrz.nome ?? viz.nome };
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
