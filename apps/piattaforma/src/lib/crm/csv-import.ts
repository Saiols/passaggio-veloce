/**
 * Parsing robusto del CSV di import contatti CRM. Logica **pura** (niente DB /
 * auth / Next) → testabile in isolamento. Gestisce:
 * - header quotato (`"Nome","Telefono",…`) tramite lo stesso parser delle righe;
 * - nomi colonna con alias italiano/varianti e accenti (`Telefono`→tel, `Città`→citta);
 * - BOM iniziale;
 * - categoria di default per i file senza colonna `cat` (es. liste rivenditori).
 *
 * L'azione server `bulkImportCrmContactsAction` usa questo modulo per il parsing
 * e si occupa solo di dedup (email) + create su Prisma.
 */

export type CrmCat = 'BROKER' | 'AGENZIA';
export type CrmStatus =
  | 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9' | 'S10';
export type CrmFonte = 'CSV_INIZIALE' | 'ISCRIZIONE_DIRETTA' | 'REFERRAL' | 'ALTRO';

export type ParsedContactRow = {
  /** Numero riga 1-based nel file originale (per i messaggi d'errore). */
  line: number;
  nome: string;
  cat: CrmCat;
  tel: string;
  wa: string | null;
  email: string | null;
  piva: string | null;
  indirizzo: string | null;
  citta: string | null;
  cap: string | null;
  regione: string | null;
  status: CrmStatus;
  fonte: CrmFonte;
};

export type CsvParseResult =
  | { ok: false; error: string }
  | {
      ok: true;
      rows: ParsedContactRow[];
      rowErrors: { line: number; message: string }[];
    };

/** CSV line parser tollerante di virgolette doppie e virgole interne. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** Normalizza un nome colonna: senza accenti, trim, minuscolo. */
function normalizeKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/** Alias dei nomi colonna → campo canonico. Le chiavi alias sono già normalizzate. */
const COLUMN_ALIASES: Record<string, readonly string[]> = {
  nome: ['nome', 'ragione sociale', 'ragionesociale', 'denominazione', 'azienda', 'nominativo', 'concessionaria'],
  cat: ['cat', 'categoria', 'tipo', 'tipologia'],
  tel: ['tel', 'telefono', 'phone', 'recapito', 'numero'],
  wa: ['wa', 'whatsapp', 'cellulare', 'mobile', 'cell'],
  email: ['email', 'e-mail', 'mail', 'posta elettronica'],
  piva: ['piva', 'p.iva', 'p iva', 'partita iva', 'partitaiva', 'vat'],
  indirizzo: ['indirizzo', 'via', 'address', 'sede'],
  citta: ['citta', 'comune', 'city', 'localita'],
  cap: ['cap', 'zip', 'codice postale'],
  regione: ['regione', 'region'],
  status: ['status', 'stato'],
  fonte: ['fonte', 'source', 'origine'],
};

/** Mappa i valori della colonna categoria (e sinonimi) sull'enum CRM. */
const CAT_VALUES: Record<string, CrmCat> = {
  broker: 'BROKER',
  dealer: 'BROKER',
  rivenditore: 'BROKER',
  rivenditori: 'BROKER',
  concessionario: 'BROKER',
  concessionaria: 'BROKER',
  agenzia: 'AGENZIA',
  agency: 'AGENZIA',
};

const STATUS_SET = new Set<string>([
  'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10',
]);
const FONTE_SET = new Set<string>([
  'CSV_INIZIALE', 'ISCRIZIONE_DIRETTA', 'REFERRAL', 'ALTRO',
]);

/** Risolve l'header in una mappa { campo canonico → indice colonna }. */
function resolveHeader(headerLine: string): Record<string, number> {
  const cells = parseCsvLine(headerLine).map(normalizeKey);
  const map: Record<string, number> = {};
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = cells.findIndex((c) => aliases.includes(c));
    if (idx >= 0) map[canonical] = idx;
  }
  return map;
}

/**
 * Parsa il CSV in righe contatto pronte per la create. Le sole colonne
 * obbligatorie sono **nome** e **telefono**; la categoria, se assente nel file,
 * usa `defaultCat`. Le righe senza nome o telefono finiscono in `rowErrors`.
 */
export function parseContactsCsv(
  csvText: string,
  defaultCat: CrmCat = 'BROKER',
): CsvParseResult {
  const lines = csvText
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { ok: false, error: 'CSV vuoto o senza header' };
  }

  const col = resolveHeader(lines[0]!);
  if (col.nome === undefined) {
    return {
      ok: false,
      error:
        'Colonna nome non riconosciuta. Accettate: Nome, Ragione sociale, Denominazione, Azienda.',
    };
  }
  if (col.tel === undefined) {
    return {
      ok: false,
      error:
        'Colonna telefono non riconosciuta. Accettate: Telefono, Tel, Recapito, Numero.',
    };
  }

  const rows: ParsedContactRow[] = [];
  const rowErrors: { line: number; message: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    const get = (canonical: string): string => {
      const j = col[canonical];
      return j !== undefined ? (cells[j] ?? '').trim() : '';
    };

    const nome = get('nome');
    const tel = get('tel');
    if (!nome || !tel) {
      rowErrors.push({
        line: i + 1,
        message: `Riga ${i + 1}: nome o telefono mancante`,
      });
      continue;
    }

    const cat = CAT_VALUES[normalizeKey(get('cat'))] ?? defaultCat;

    const statusRaw = get('status').toUpperCase();
    const status: CrmStatus = STATUS_SET.has(statusRaw)
      ? (statusRaw as CrmStatus)
      : 'S0';
    const fonteRaw = get('fonte').toUpperCase();
    const fonte: CrmFonte = FONTE_SET.has(fonteRaw)
      ? (fonteRaw as CrmFonte)
      : 'CSV_INIZIALE';

    rows.push({
      line: i + 1,
      nome,
      cat,
      tel,
      wa: get('wa') || null,
      email: get('email').toLowerCase() || null,
      piva: get('piva') || null,
      indirizzo: get('indirizzo') || null,
      citta: get('citta') || null,
      cap: get('cap') || null,
      regione: get('regione') || null,
      status,
      fonte,
    });
  }

  return { ok: true, rows, rowErrors };
}
