import type { LibrettoCircolazioneData, OwnerInfo } from './types';
import { isValidCodiceFiscale } from '@/lib/kyc/match';

const TARGA_RE = /\b([A-Z]{2}\d{3}[A-Z]{2})\b/;
const TELAIO_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/;
// Maschera posizionale del codice fiscale: L=lettera, D=cifra. Serve a correggere
// le tipiche confusioni OCR (soprattutto O↔0 sul carattere di controllo finale,
// che è SEMPRE una lettera) prima di validare col check-digit.
const CF_MASK = 'LLLLLLDDLDDLDDDL';
// Candidato CF: token di 16 caratteri alfanumerici (anche con confusioni OCR).
const CF_LOOSE_RE = /\b[A-Z0-9]{16}\b/g;
const DATE = String.raw`(\d{2})[./-](\d{2})[./-](\d{4})`;

/** Corregge un candidato 16-char secondo la maschera (O/Q→0, I/L→1 nelle
 *  posizioni cifra; 0→O, 1→I nelle posizioni lettera) e lo ritorna SOLO se è un
 *  CF valido (check-digit). La validazione garantisce zero falsi positivi. */
function coerceCf(raw: string): string | undefined {
  if (raw.length !== 16) return undefined;
  let out = '';
  for (let i = 0; i < 16; i++) {
    const ch = raw[i]!;
    if (CF_MASK[i] === 'L') {
      out += ch === '0' ? 'O' : ch === '1' ? 'I' : ch;
    } else {
      out += ch === 'O' || ch === 'Q' ? '0' : ch === 'I' || ch === 'L' ? '1' : ch;
    }
  }
  return isValidCodiceFiscale(out) ? out : undefined;
}

/** Primo CF valido (con correzione OCR) in un testo; opzionalmente vincolato al
 *  codice-cognome (per associare un CF sparso al comproprietario giusto). */
function findCf(text: string, cognomeCode?: string): string | undefined {
  const re = new RegExp(CF_LOOSE_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const cf = coerceCf(m[0]);
    if (cf && (!cognomeCode || cf.slice(0, 3) === cognomeCode)) return cf;
  }
  return undefined;
}

// La carta di circolazione riporta sul retro la legenda "SIGNIFICATO DEI CODICI
// COMUNITARI ARMONIZZATI", dove gli stessi codici (C.2.1, (I), ...) compaiono
// come DESCRIZIONI. Parsiamo solo la sezione dati (prima della legenda) per
// ancorarci ai valori reali e non alle definizioni.
const LEGEND_HEADER = 'SIGNIFICATO DEI CODICI';

/** Converte una data testuale (dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy) in ISO yyyy-mm-dd. */
function toIso(d: string, m: string, y: string): string {
  return `${y}-${m}-${d}`;
}

/** Estrae la prima data che segue un codice (es. "(B)") nella sezione dati. */
function dateAfter(text: string, labelPattern: string): { iso: string; year: number } | undefined {
  const m = new RegExp(labelPattern + String.raw`\s*` + DATE).exec(text);
  if (!m) return undefined;
  return { iso: toIso(m[1]!, m[2]!, m[3]!), year: Number(m[3]) };
}

/** Estrae il valore testuale che segue un codice, fino a fine riga o prossimo "(". */
function fieldAfter(text: string, labelPattern: string): string | undefined {
  const m = new RegExp(labelPattern + String.raw`\s*([^\n(]+)`).exec(text);
  const v = m?.[1]?.trim();
  return v && v.length > 0 ? v : undefined;
}

/**
 * Estrae un intestatario dato il prefisso codice ("C\\.2" o "C\\.3").
 * Se è presente il "nome" (.2) → persona fisica (CF tra .2 e .3); altrimenti →
 * persona giuridica (P.IVA = 11 cifre nella finestra dopo .1).
 */
function parseOwner(data: string, prefix: string): OwnerInfo | undefined {
  const p1 = fieldAfter(data, `\\(${prefix}\\.1\\)`); // cognome o ragione sociale
  if (!p1) return undefined;
  const p2 = fieldAfter(data, `\\(${prefix}\\.2\\)`); // nome (assente per le aziende)
  const i1 = data.search(new RegExp(`\\(${prefix}\\.1\\)`));
  if (p2) {
    const i3 = data.search(new RegExp(`\\(${prefix}\\.3\\)`));
    const seg = i1 >= 0 ? data.slice(i1, i3 > i1 ? i3 : i1 + 400) : '';
    const cf = findCf(seg);
    return { isPersonaGiuridica: false, cognome: p1, nome: p2, cf, display: `${p1} ${p2}`.trim() };
  }
  const seg = i1 >= 0 ? data.slice(i1, i1 + 600) : '';
  const pivaM = /\b(\d{11})\b/.exec(seg);
  return { isPersonaGiuridica: true, ragioneSociale: p1, piva: pivaM ? pivaM[1] : undefined, display: p1 };
}

/** Codice cognome del CF: prime 3 consonanti, poi vocali, poi 'X' di padding
 *  (regola Agenzia delle Entrate per il cognome). Serve ad associare un CF
 *  sparso nel testo al comproprietario giusto. */
function cfCognomeCode(cognome: string): string {
  const up = cognome.toUpperCase().replace(/[^A-Z]/g, '');
  const cons = up.replace(/[AEIOU]/g, '');
  const vow = up.replace(/[^AEIOU]/g, '');
  return (cons + vow + 'XXX').slice(0, 3);
}

/**
 * Comproprietario "(COMPR)": secondo intestatario (doppio intestatario) reso
 * dalla carta con il marcatore (COMPR) invece del codice C.3. Document AI
 * linearizza il blocco in modo sparso — dopo "(COMPR) <cognome>" c'è il <nome>
 * su riga a sé, mentre "NATO IL … (CF)" finisce lontano nel testo. Estraiamo
 * cognome+nome dal marcatore e, best-effort, il CF cercando nel testo intero un
 * codice fiscale VALIDO il cui codice-cognome combaci (associazione robusta al
 * disordine dell'OCR).
 */
function parseComproprietario(data: string, fullText: string): OwnerInfo | undefined {
  const i = data.search(/\(COMPR\)/);
  if (i < 0) return undefined;
  const lines = data.slice(i).split('\n');
  const nameParts: string[] = [];
  const first = lines[0]!.replace(/\(COMPR\)/, '').trim();
  if (first) nameParts.push(first);
  // Righe successive di solo lettere = resto del nome; ci si ferma alla prima
  // riga non-nome (numero carta/targa, codice "(X.Y)", "NATO IL …", indirizzo).
  for (let k = 1; k < lines.length && k <= 4 && nameParts.length < 4; k++) {
    const ln = lines[k]!.trim();
    if (/^[A-Z'][A-Z' ]*$/.test(ln) && !/\bNATO\b|\bDEL\b/.test(ln)) nameParts.push(ln);
    else break;
  }
  const tokens = nameParts.join(' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!tokens.length) return undefined;
  const cognome = tokens[0]!;
  const nome = tokens.length > 1 ? tokens.slice(1).join(' ') : undefined;

  // CF: primo CF valido (con correzione OCR) il cui codice-cognome combacia.
  const cf = findCf(fullText, cfCognomeCode(cognome));

  return {
    isPersonaGiuridica: false,
    cognome,
    nome,
    cf,
    display: [cognome, nome].filter(Boolean).join(' '),
  };
}

/** Telaio (VIN, 17 caratteri). I VIN non usano mai O/I/Q: se l'OCR li ha
 * introdotti (tipico: O al posto di 0) normalizziamo e ri-validiamo.
 *
 * Sulla carta di circolazione il VIN è il campo (E) "numero di identificazione
 * del veicolo". Il campo (D.2) "tipo/variante/versione" può però contenere un
 * codice di omologazione di 17 caratteri alfanumerici che combacia col pattern
 * del VIN e PRECEDE (E): una ricerca "primo token di 17 char" su tutto il testo
 * aggancia il codice sbagliato. Ci ancoriamo quindi a (E) quando presente;
 * altrimenti (ricevute PRA, testo libero) usiamo il primo token VIN-shaped. */
function extractTelaio(data: string): string | undefined {
  const eIdx = data.search(/\(E\)/);
  const scope = eIdx >= 0 ? data.slice(eIdx) : data;
  const strict = TELAIO_RE.exec(scope)?.[1];
  if (strict) return strict;
  const m = /\b[A-Z0-9]{17}\b/.exec(scope);
  if (!m) return undefined;
  const norm = m[0].replace(/[OIQ]/g, (c) => (c === 'I' ? '1' : '0'));
  return TELAIO_RE.test(norm) ? norm : undefined;
}

// Etichetta di trasferimento di proprietà applicata sul retro del libretto: su
// auto ex-noleggio/leasing il campo (C.2.1) resta la società locatrice, ma la
// proprietà è stata trasferita a una persona tramite etichetta fisica
// ("TRASFERIMENTO DI PROPRIETA'" → data → "PROPRIETARIO <cognome> <nome>" + CF).
// Nella linearizzazione di Document AI l'etichetta finisce DOPO la legenda,
// quindi va cercata su tutto il testo, non sulla sola sezione dati. L'etichetta
// prevale SEMPRE sull'intestatario in (C.2.x); se ce ne sono più d'una (più
// passaggi annotati nel riquadro in basso a sinistra) prevale quella con la
// DATA PIÙ RECENTE, che è anche la data di acquisto dell'attuale proprietario
// (→ regime pre/post-2015 del nuovo proprietario, non dell'immatricolazione).
//
// Discriminatori anti-legenda (la legenda contiene "(C.2) proprietario del
// veicolo"): (a) il nome catturato non deve iniziare con una stopword ("DEL",
// "DI", ...); (b) deve esserci un CF persona fisica VALIDO (check digit) nella
// finestra dopo l'etichetta OPPURE il marcatore "TRASFERIMENTO" prima — la
// legenda non ha né l'uno né l'altro.
const STOPWORDS_DOPO_PROPRIETARIO = /^(?:DEL|DELLA|DELLO|DEI|DEGLI|DELLE|DI|E)\b/;
const DATE_G = new RegExp(DATE, 'g');

type StickerHit = { owner: OwnerInfo; date?: string };

/** Data di trasferimento in una regione di testo: la data più recente che NON
 * sia una data di nascita ("NATO/A IL ..."). Confronto su ISO yyyy-mm-dd =
 * cronologico. Undefined se non ci sono date utili. */
function transferDateInRegion(region: string): string | undefined {
  let best: string | undefined;
  let m: RegExpExecArray | null;
  DATE_G.lastIndex = 0;
  while ((m = DATE_G.exec(region))) {
    const pre = region.slice(Math.max(0, m.index - 12), m.index);
    if (/NAT[OA]\s+IL\s*$/.test(pre)) continue; // data di nascita, non di trasferimento
    const iso = toIso(m[1]!, m[2]!, m[3]!);
    if (!best || iso > best) best = iso;
  }
  return best;
}

/** Tutte le etichette di trasferimento valide nel testo, con la rispettiva data
 * (best-effort). Persona fisica: cognome + nome nell'ordine dell'etichetta,
 * separatore "*" o spazio. */
function parseTrasferimentoStickers(upper: string): StickerHit[] {
  const re = /PROPRIETARIO[ \t]+([A-Z*][A-Z'* \t]*)/g;
  const hits: StickerHit[] = [];
  let prevEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(upper))) {
    const anchorStart = m.index;
    const anchorEnd = m.index + m[0].length;
    const rawName = m[1]!.trim();
    if (!rawName || STOPWORDS_DOPO_PROPRIETARIO.test(rawName)) {
      prevEnd = anchorEnd;
      continue;
    }
    const after = upper.slice(anchorEnd, anchorEnd + 160);
    const cf = findCf(after);
    // Finestra "prima" del nome (dove stanno il marcatore TRASFERIMENTO e la
    // data), limitata all'etichetta precedente per non sconfinare.
    const back = upper.slice(Math.max(prevEnd, anchorStart - 200), anchorStart);
    const ti = back.lastIndexOf('TRASFERIMENTO');
    if (!cf && ti < 0) {
      prevEnd = anchorEnd;
      continue; // né CF valido né marcatore: non è un'etichetta
    }
    // Data dal blocco TRASFERIMENTO (se c'è) per non pescare le date della carta.
    const date =
      transferDateInRegion(ti >= 0 ? back.slice(ti) : back) ?? transferDateInRegion(after);
    const tokens = rawName
      .split(/[*\s]+/)
      .map((t) => t.replace(/\*/g, '').trim())
      .filter(Boolean);
    if (tokens.length) {
      const cognome = tokens[0]!;
      const nome = tokens.length > 1 ? tokens.slice(1).join(' ') : undefined;
      hits.push({
        owner: { isPersonaGiuridica: false, cognome, nome, cf, display: tokens.join(' ') },
        date,
      });
    }
    prevEnd = anchorEnd;
  }
  return hits;
}

/** Etichetta vincente: la più recente per data; le datate battono le non datate;
 * a parità/assenza di date, l'ultima nel testo. Undefined se non ce ne sono. */
function pickStickerWinner(hits: StickerHit[]): StickerHit | undefined {
  if (!hits.length) return undefined;
  const dated = hits.filter((h) => h.date);
  if (dated.length) return dated.reduce((a, b) => (b.date! > a.date! ? b : a));
  return hits[hits.length - 1];
}

// Ricevuta PRA / minivoltura: "DOCUMENTO NON VALIDO PER LA CIRCOLAZIONE" +
// "N. PROGRESSIVO PRA". Testo libero (niente codici armonizzati/legenda).
// L'intestatario è il COMMERCIANTE (azienda).
const DEALER_MARKER = 'PROGRESSIVO PRA';

/** Estrae l'intestatario (azienda commerciante) e la data di acquisto da una
 * ricevuta PRA. Ragione sociale = riga non vuota subito sopra la P.IVA (11 cifre);
 * data acquisto = "Scrittura Privata del GG-MM-AAAA". */
function parseRicevutaPra(data: string): {
  proprietariInfo: OwnerInfo[];
  dataAcquisto?: string;
} {
  const lines = data.split('\n').map((l) => l.trim());
  let owner: OwnerInfo | undefined;
  for (let i = 1; i < lines.length; i++) {
    if (/^\d{11}$/.test(lines[i]!)) {
      let j = i - 1;
      while (j >= 0 && !lines[j]) j--;
      const ragioneSociale = j >= 0 ? lines[j]! : undefined;
      if (ragioneSociale) {
        owner = { isPersonaGiuridica: true, ragioneSociale, piva: lines[i]!, display: ragioneSociale };
      }
      break;
    }
  }
  const sp = new RegExp(`SCRITTURA PRIVATA DEL\\s+${DATE}`).exec(data);
  const dataAcquisto = sp ? toIso(sp[1]!, sp[2]!, sp[3]!) : undefined;
  return { proprietariInfo: owner ? [owner] : [], dataAcquisto };
}

/** Estrae i campi del libretto dal testo OCR. Tutti i campi sono best-effort:
 * un campo non trovato resta undefined (la pre-compilazione è editabile). */
export function parseLibrettoText(text: string, confidence: number): LibrettoCircolazioneData {
  const upper = text.toUpperCase();
  const legendIdx = upper.indexOf(LEGEND_HEADER);
  const data = legendIdx >= 0 ? upper.slice(0, legendIdx) : upper;

  const targa = TARGA_RE.exec(data)?.[1];
  const telaio = extractTelaio(data);

  // (B) data della prima immatricolazione; fallback alla prima data trovata.
  const immat =
    dateAfter(data, String.raw`\(B\)`) ??
    (() => {
      const m = new RegExp(DATE).exec(data);
      return m ? { iso: toIso(m[1]!, m[2]!, m[3]!), year: Number(m[3]) } : undefined;
    })();
  const dataImmatricolazione = immat?.iso;

  // Una ricevuta PRA (minivoltura) è "DOCUMENTO NON VALIDO PER LA CIRCOLAZIONE",
  // a testo libero, SENZA codici armonizzati. Una carta di circolazione può però
  // riportare l'annotazione di un passaggio ("N. Progressivo PRA" + "Scrittura
  // Privata del ...") pur restando una carta col proprietario nei codici (C.2.x):
  // in quel caso NON è una ricevuta PRA e il proprietario va letto da (C.2.1)/(C.2.2),
  // non interpretato come azienda commerciante.
  const isRicevutaPra = data.includes(DEALER_MARKER) && !data.includes('(C.2.1)');

  let proprietariInfo: OwnerInfo[];
  let dataAcquisto: string | undefined;
  let annoAcquisto: number | undefined;

  // Etichetta di trasferimento sul retro: se presente, l'intestatario
  // dell'etichetta è l'attuale e SOSTITUISCE C.2.x (auto ex-noleggio rivendute a
  // privati). Con più etichette vince la più recente. Cercata su TUTTO il testo
  // (è dopo la legenda).
  const sticker = isRicevutaPra ? undefined : pickStickerWinner(parseTrasferimentoStickers(upper));

  if (isRicevutaPra) {
    // Ricevuta PRA (venditore commerciante): intestatario = azienda;
    // acquisto = data della scrittura privata.
    const pra = parseRicevutaPra(data);
    proprietariInfo = pra.proprietariInfo;
    dataAcquisto = pra.dataAcquisto;
    annoAcquisto = dataAcquisto ? Number(dataAcquisto.slice(0, 4)) : undefined;
  } else if (sticker) {
    // Etichetta di trasferimento: intestatario + data di acquisto dall'etichetta
    // (la data del trasferimento determina il regime del NUOVO proprietario).
    // Fallback a (I) solo se l'etichetta non riporta una data leggibile.
    proprietariInfo = [sticker.owner];
    const acquisto = dateAfter(data, String.raw`\((?:I|1|L)\)`);
    dataAcquisto = sticker.date ?? acquisto?.iso;
    annoAcquisto = dataAcquisto ? Number(dataAcquisto.slice(0, 4)) : undefined;
  } else {
    // (I) data di immatricolazione cui si riferisce la carta = data di acquisto
    // dell'attuale proprietario. L'OCR rende spesso "(I)" come "(1)" o "(L)".
    const acquisto = dateAfter(data, String.raw`\((?:I|1|L)\)`);
    dataAcquisto = acquisto?.iso;
    annoAcquisto = acquisto?.year;
    // Intestatari: C.2 (proprietario) + C.3 (secondo intestatario/utilizzatore,
    // es. nei leasing) + (COMPR) comproprietario (doppio intestatario). Ciascuno
    // può essere azienda o persona.
    proprietariInfo = [
      parseOwner(data, 'C\\.2'),
      parseOwner(data, 'C\\.3'),
      parseComproprietario(data, upper),
    ].filter((o): o is OwnerInfo => o !== undefined);
  }

  const proprietari = proprietariInfo.length ? proprietariInfo.map((o) => o.display) : undefined;
  const proprietarioAttuale = proprietariInfo[0]?.display;
  const proprietarioCf = proprietariInfo[0]?.cf;

  // pre-2015 = regime Certificato di Proprietà, determinato dalla data di
  // ACQUISTO dell'attuale proprietario; fallback alla prima immatricolazione.
  const annoRegime = annoAcquisto ?? immat?.year;
  const preImm2015 = annoRegime !== undefined && annoRegime < 2015;

  return {
    targa,
    telaio,
    dataImmatricolazione,
    dataAcquisto,
    proprietarioAttuale,
    proprietarioCf,
    proprietari,
    proprietariInfo,
    preImm2015,
    flagComodatoDuso: /COMODATO/.test(data),
    confidenceScore: confidence,
    rawText: text,
  };
}
