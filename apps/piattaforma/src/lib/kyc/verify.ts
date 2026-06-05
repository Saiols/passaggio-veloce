import 'server-only';
import type { CompanyType } from '@pv/db';
import type { OcrExtractInput } from '@/lib/providers/ocr';
import { isVisuraDateValid } from '@/lib/auth/document-validation';
import { isAtecoAllowed, type AllowedAteco } from './ateco';
import { companyMatches, nameMatches, normalizeCf } from './match';
import { extractVisura, type VisuraData } from './visura-parser';
import { extractCi, type CiData } from './extract-ci';
import { extractCf, type CfData } from './extract-cf';

const VISURA_MAX_AGE_MONTHS = 5;

export type KycFailure = {
  rule: 'VISURA_SCADUTA' | 'ATECO_NON_IDONEO' | 'AZIENDA_MISMATCH' | 'CI_MISMATCH' | 'CF_MISMATCH' | 'ILLEGGIBILE';
  doc?: 'CI' | 'CF' | 'VISURA';
  message: string;
};

export type KycResult =
  | { passed: true; extracted: { visura: VisuraData; ci: CiData; cf: CfData } }
  | { passed: false; failures: KycFailure[] };

export type KycDeps = {
  getVisuraData: (input: OcrExtractInput) => Promise<VisuraData>;
  getCiData: (input: OcrExtractInput) => Promise<CiData>;
  getCfData: (input: OcrExtractInput) => Promise<CfData>;
};

/** Deps reali: visura via unpdf/DocAI, CI/CF via Document OCR. */
export const defaultKycDeps: KycDeps = {
  getVisuraData: (input) => extractVisura(input),
  getCiData: async (input) => {
    const { getOcr } = await import('@/lib/providers/ocr');
    const ocr = await getOcr();
    return extractCi((await ocr.extractText(input)).text);
  },
  getCfData: async (input) => {
    const { getOcr } = await import('@/lib/providers/ocr');
    const ocr = await getOcr();
    return extractCf((await ocr.extractText(input)).text);
  },
};

export async function verifyRegistrationKyc(
  args: {
    files: { ciFronte: OcrExtractInput; codiceFiscale: OcrExtractInput; visura: OcrExtractInput };
    company: { ragioneSociale: string; partitaIva: string; type: CompanyType };
    allowedAteco: AllowedAteco[];
    now?: Date;
  },
  deps: KycDeps = defaultKycDeps,
): Promise<KycResult> {
  const now = args.now ?? new Date();
  const [visura, ci, cf] = await Promise.all([
    deps.getVisuraData(args.files.visura),
    deps.getCiData(args.files.ciFronte),
    deps.getCfData(args.files.codiceFiscale),
  ]);

  const failures: KycFailure[] = [];

  // Illeggibilità (campi chiave mancanti) — distinta dal mismatch.
  if (!visura.dataEmissione || !visura.ateco || (!visura.partitaIva && !visura.denominazione)) {
    failures.push({ rule: 'ILLEGGIBILE', doc: 'VISURA', message: 'Non siamo riusciti a leggere la visura: carica il PDF originale (non una scansione).' });
  }
  const adminNameReadable = !!(visura.amministratore?.nome && visura.amministratore?.cognome);
  const adminCfReadable = !!visura.amministratore?.codiceFiscale;
  if (!adminNameReadable || !adminCfReadable) {
    failures.push({
      rule: 'ILLEGGIBILE',
      doc: 'VISURA',
      message: "Non siamo riusciti a leggere completamente l'amministratore nella visura (servono nome, cognome e codice fiscale): carica il PDF originale.",
    });
  }
  if (!ci.nome || !ci.cognome) {
    failures.push({ rule: 'ILLEGGIBILE', doc: 'CI', message: 'Non siamo riusciti a leggere nome e cognome dalla carta d\'identità: ricarica una foto più nitida.' });
  }
  if (!cf.codiceFiscale) {
    failures.push({ rule: 'ILLEGGIBILE', doc: 'CF', message: 'Non siamo riusciti a leggere il codice fiscale: ricarica una foto più nitida della tessera sanitaria.' });
  }

  // Regole di mismatch (solo se i dati necessari sono leggibili).
  if (visura.dataEmissione) {
    const age = isVisuraDateValid(visura.dataEmissione, VISURA_MAX_AGE_MONTHS, now);
    if (!age.ok) failures.push({ rule: 'VISURA_SCADUTA', doc: 'VISURA', message: age.error });
  }
  if (visura.ateco && !isAtecoAllowed(visura.ateco, args.company.type, args.allowedAteco)) {
    failures.push({ rule: 'ATECO_NON_IDONEO', doc: 'VISURA', message: `Il codice ATECO ${visura.ateco} non rientra tra le attività ammesse per la registrazione.` });
  }
  if ((visura.partitaIva || visura.denominazione) &&
      !companyMatches(visura, { denominazione: args.company.ragioneSociale, partitaIva: args.company.partitaIva })) {
    failures.push({ rule: 'AZIENDA_MISMATCH', doc: 'VISURA', message: 'I dati della visura non corrispondono all\'azienda inserita (ragione sociale / P.IVA).' });
  }
  if (ci.nome && ci.cognome && visura.amministratore && (visura.amministratore.nome || visura.amministratore.cognome)) {
    const ciFull = `${ci.nome} ${ci.cognome}`;
    const adminFull = `${visura.amministratore.nome ?? ''} ${visura.amministratore.cognome ?? ''}`;
    if (!nameMatches(ciFull, adminFull)) {
      failures.push({ rule: 'CI_MISMATCH', doc: 'CI', message: 'Il nome sulla carta d\'identità non corrisponde all\'amministratore indicato in visura.' });
    }
  }
  if (cf.codiceFiscale && visura.amministratore?.codiceFiscale) {
    if (normalizeCf(cf.codiceFiscale) !== normalizeCf(visura.amministratore.codiceFiscale)) {
      failures.push({ rule: 'CF_MISMATCH', doc: 'CF', message: 'Il codice fiscale caricato non corrisponde all\'amministratore indicato in visura.' });
    }
  }

  if (failures.length) return { passed: false, failures };
  return { passed: true, extracted: { visura, ci, cf } };
}
