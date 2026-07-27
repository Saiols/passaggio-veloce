/**
 * Assegnazione greedy senza conflitti fra identità registrate e righe CRM.
 * Modulo PURO.
 *
 * Un contatto va a una sola identità e un'identità prende un solo contatto
 * (spec D2): sui 19k della lista il 30% condivide il telefono con un'altra
 * riga, quindi la concorrenza è la norma, non l'eccezione.
 *
 * L'ordine è deterministico — punteggio desc, poi contatto più vecchio, poi id
 * — così due esecuzioni sulla stessa fotografia del DB danno lo stesso esito.
 *
 * Costo: i candidati si prendono da un indice sulle chiavi forti, non dal
 * prodotto cartesiano (19k contatti × N identità sarebbe insostenibile).
 */
import type { Identita } from './identita';
import { valuta, type ContattoPerMatch } from './score';

export type Coppia = {
  identita: Identita;
  contatto: ContattoPerMatch;
  punteggio: number;
  campi: string[];
};

export function chiaveIdentita(i: Identita): string {
  return `${i.companyId}:${i.sedeId ?? 'madre'}`;
}

function indicizza(
  contatti: ContattoPerMatch[],
  chiaviDi: (c: ContattoPerMatch) => string[],
): Map<string, ContattoPerMatch[]> {
  const m = new Map<string, ContattoPerMatch[]>();
  for (const c of contatti) {
    for (const k of chiaviDi(c)) {
      const arr = m.get(k);
      if (arr) arr.push(c);
      else m.set(k, [c]);
    }
  }
  return m;
}

export function assegna(
  identita: Identita[],
  contatti: ContattoPerMatch[],
): Coppia[] {
  const perTel = indicizza(contatti, (c) => c.telKeys);
  const perEmail = indicizza(contatti, (c) => c.emailKeys);
  const perPiva = indicizza(contatti, (c) => c.pivaKeys);

  const coppie: Coppia[] = [];
  for (const id of identita) {
    const candidati = new Map<string, ContattoPerMatch>();
    const raccogli = (mappa: Map<string, ContattoPerMatch[]>, keys: string[]) => {
      for (const k of keys) {
        for (const c of mappa.get(k) ?? []) candidati.set(c.id, c);
      }
    };
    raccogli(perTel, id.telKeys);
    raccogli(perEmail, id.emailKeys);
    raccogli(perPiva, id.pivaKeys);

    for (const c of candidati.values()) {
      const v = valuta(id, c);
      if (v.ammesso) {
        coppie.push({ identita: id, contatto: c, punteggio: v.punteggio, campi: v.campi });
      }
    }
  }

  coppie.sort(
    (a, b) =>
      b.punteggio - a.punteggio ||
      a.contatto.createdAt.getTime() - b.contatto.createdAt.getTime() ||
      a.contatto.id.localeCompare(b.contatto.id) ||
      chiaveIdentita(a.identita).localeCompare(chiaveIdentita(b.identita)),
  );

  const contattiPresi = new Set<string>();
  const identitaPrese = new Set<string>();
  const scelte: Coppia[] = [];
  for (const co of coppie) {
    const ik = chiaveIdentita(co.identita);
    if (contattiPresi.has(co.contatto.id) || identitaPrese.has(ik)) continue;
    contattiPresi.add(co.contatto.id);
    identitaPrese.add(ik);
    scelte.push(co);
  }
  return scelte;
}
