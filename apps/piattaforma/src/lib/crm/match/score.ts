/**
 * Ammissione e punteggio di una coppia (identità registrata, contatto CRM).
 * Modulo PURO.
 *
 * Regola (spec D1): serve almeno una PROVA FORTE — P.IVA, email/PEC,
 * telefono/WhatsApp. Nome, indirizzo, città e CAP non bastano mai da soli:
 * mezza Trento condivide città e CAP.
 *
 * Eccezione categoria: se la riga è BROKER e l'azienda è AGENZIA (o viceversa)
 * la prova forte da sola non basta — serve un secondo campo in comune. È la
 * protezione contro i centralini di gruppo condivisi da attività diverse.
 *
 * Il punteggio serve solo a ordinare le proposte: "più campi uguali vince".
 */
import type { Identita } from './identita';
import {
  normalizeNome,
  normalizeIndirizzo,
  normalizeCitta,
  normalizeCap,
} from './normalize';

export const PESI = {
  piva: 100,
  email: 60,
  tel: 50,
  nome: 25,
  indirizzo: 20,
  nomeParziale: 15,
  cap: 5,
  citta: 5,
} as const;

export type ContattoGrezzo = {
  id: string;
  cat: 'BROKER' | 'AGENZIA';
  nome: string;
  tel: string | null;
  indirizzo: string | null;
  citta: string | null;
  cap: string | null;
  telNorm: string | null;
  waNorm: string | null;
  emailNorm: string | null;
  pivaNorm: string | null;
  createdAt: Date;
};

export type ContattoPerMatch = {
  id: string;
  cat: 'BROKER' | 'AGENZIA';
  createdAt: Date;
  /** Grezzi, per la UI dell'anteprima. */
  nome: string;
  tel: string | null;
  citta: string | null;
  /** Chiavi, calcolate una volta sola. */
  telKeys: string[];
  emailKeys: string[];
  pivaKeys: string[];
  nomeKey: string;
  indirizzoKey: string;
  cittaKey: string;
  capKey: string;
};

const chiavi = (...valori: Array<string | null>): string[] =>
  [...new Set(valori.filter((v): v is string => !!v && v !== ''))];

/**
 * Normalizza una volta sola i campi deboli del contatto: `valuta` viene
 * chiamata migliaia di volte e non deve rifare il lavoro a ogni giro.
 */
export function preparaContatto(r: ContattoGrezzo): ContattoPerMatch {
  return {
    id: r.id,
    cat: r.cat,
    createdAt: r.createdAt,
    nome: r.nome,
    tel: r.tel,
    citta: r.citta,
    telKeys: chiavi(r.telNorm, r.waNorm),
    emailKeys: chiavi(r.emailNorm),
    pivaKeys: chiavi(r.pivaNorm),
    nomeKey: normalizeNome(r.nome),
    indirizzoKey: normalizeIndirizzo(r.indirizzo),
    cittaKey: normalizeCitta(r.citta),
    capKey: normalizeCap(r.cap),
  };
}

export type Valutazione = {
  ammesso: boolean;
  punteggio: number;
  campi: string[];
};

const intersecano = (a: string[], b: string[]): boolean =>
  a.some((x) => x !== '' && b.includes(x));

const ugualiNonVuote = (a: string, b: string): boolean => a !== '' && a === b;

/** `contenuto` compare per parole intere dentro `contenitore` (min. 2 parole). */
function contieneParole(contenitore: string, contenuto: string): boolean {
  if (contenitore === '' || contenuto === '') return false;
  if (contenuto.split(' ').length < 2) return false;
  return ` ${contenitore} `.includes(` ${contenuto} `);
}

export function valuta(id: Identita, c: ContattoPerMatch): Valutazione {
  const campi: string[] = [];
  let punteggio = 0;

  if (intersecano(id.pivaKeys, c.pivaKeys)) {
    campi.push('piva');
    punteggio += PESI.piva;
  }
  if (intersecano(id.emailKeys, c.emailKeys)) {
    campi.push('email');
    punteggio += PESI.email;
  }
  if (intersecano(id.telKeys, c.telKeys)) {
    campi.push('tel');
    punteggio += PESI.tel;
  }
  if (id.nomeKeys.some((n) => ugualiNonVuote(n, c.nomeKey))) {
    campi.push('nome');
    punteggio += PESI.nome;
  } else if (
    id.nomeKeys.some(
      (n) => contieneParole(n, c.nomeKey) || contieneParole(c.nomeKey, n),
    )
  ) {
    campi.push('nome~');
    punteggio += PESI.nomeParziale;
  }
  if (ugualiNonVuote(id.indirizzoKey, c.indirizzoKey)) {
    campi.push('indirizzo');
    punteggio += PESI.indirizzo;
  }
  if (ugualiNonVuote(id.capKey, c.capKey)) {
    campi.push('cap');
    punteggio += PESI.cap;
  }
  if (ugualiNonVuote(id.cittaKey, c.cittaKey)) {
    campi.push('citta');
    punteggio += PESI.citta;
  }

  const forte = campi.some((k) => k === 'piva' || k === 'email' || k === 'tel');
  const catCoerente = id.cat === c.cat;
  const ammesso = forte && (catCoerente || campi.length >= 2);

  return { ammesso, punteggio, campi };
}
