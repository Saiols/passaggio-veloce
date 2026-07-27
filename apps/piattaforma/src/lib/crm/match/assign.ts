/**
 * Assegnazione greedy senza conflitti fra identità registrate e righe CRM.
 * Modulo PURO.
 *
 * Un contatto va a una sola identità e un'identità prende un solo contatto
 * (spec D2): sui 19k della lista il 30% condivide il telefono con un'altra
 * riga, quindi la concorrenza è la norma, non l'eccezione.
 *
 * L'ordine è deterministico — punteggio desc, poi contatto più vecchio, poi id
 * contatto, poi sede prima di madre (a parità di tutto il resto: vedi sotto),
 * poi chiave identità in ordine codepoint puro (non localeCompare, che dipende
 * da ICU/locale del runtime: Windows, CI e Vercel potrebbero ordinare
 * diversamente). Così due esecuzioni sulla stessa fotografia del DB danno lo
 * stesso esito anche in ambienti diversi.
 *
 * Sede prima di madre è una regola ESPLICITA, non un effetto collaterale
 * dell'ordine alfabetico delle chiavi identità: succede sui dati reali che
 * una sede abbia lo stesso nome/telefono/indirizzo della madre (agenzia
 * mono-sede) e quindi contenda lo stesso contatto con lo stesso punteggio.
 * L'aggancio con sedeId valorizzato è più preciso (dice QUALE punto vendita,
 * non solo quale azienda), quindi vince sempre, indipendentemente da come è
 * fatto l'id della sede.
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
  /**
   * La coppia ha vinto un ex aequo, non un confronto. Vale true quando esiste
   * un'altra coppia ammessa con lo STESSO punteggio che contende la stessa
   * identità (due righe della lista per la stessa azienda) oppure lo stesso
   * contatto da parte di un'ALTRA azienda. Lo spareggio qui sotto è
   * deterministico ma arbitrario nel merito, e non esiste un percorso di
   * sgancio: chi applica senza guardare (il cron) deve poterle lasciare
   * indietro. Vedi `riconciliaTutto` in apply.ts.
   */
  ambigua: boolean;
};

/** Le due sole chiavi che identificano una coppia (azienda, sede|madre). */
export type ChiaveDiCoppia = { companyId: string | null; sedeId: string | null };

/**
 * Fonte unica del formato della chiave "<companyId>:<sedeId|madre>". Usata
 * sia per le identità (via `chiaveIdentita`) sia da `engine.ts` per
 * confrontare le coppie companyId/sedeId grezze lette dal DB (contatti già
 * agganciati): così le due stringhe non possono divergere in silenzio se
 * qualcuno riscrive il formato a mano in un secondo punto.
 */
export function chiaveDaCoppia({ companyId, sedeId }: ChiaveDiCoppia): string {
  return `${companyId}:${sedeId ?? 'madre'}`;
}

export function chiaveIdentita(i: Identita): string {
  return chiaveDaCoppia(i);
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
        coppie.push({
          identita: id,
          contatto: c,
          punteggio: v.punteggio,
          campi: v.campi,
          ambigua: false, // calcolata sotto, quando tutte le rivali sono note
        });
      }
    }
  }

  // Rivali a pari punteggio, misurate su TUTTE le coppie ammesse (non solo su
  // quelle che sopravvivono al greedy: una coppia scartata perché il contatto
  // era già preso resta comunque la prova che la scelta era un ex aequo).
  //
  // Due indici, uno per clausola:
  // - per identità: quanti contatti diversi la contendono a quel punteggio.
  //   È il caso dei 2.373 numeri di telefono condivisi da più righe della
  //   lista — la clausola che conta davvero.
  // - per contatto: quante AZIENDE diverse lo contendono a quel punteggio.
  //   Si guardano le aziende, non le identità, di proposito: madre e "sede
  //   principale" della stessa azienda hanno per costruzione gli stessi
  //   recapiti (la registrazione crea la sede copiando nome/indirizzo/
  //   telefono/email dalla madre, vedi `(auth)/actions.ts`), quindi
  //   contendono SEMPRE lo stesso contatto con lo stesso punteggio. Misurato
  //   sul DB locale: 20 sedi su 22 sono il gemello della madre, e il caso
  //   reale Corsico risulterebbe ambiguo — cioè il match di riferimento
  //   dell'intera feature non verrebbe mai applicato dal cron. Quel pareggio
  //   però NON è arbitrario: è risolto sopra da una regola esplicita di
  //   progetto (vince la sede, aggancio più preciso) e in entrambi i casi
  //   l'azienda agganciata è la stessa. L'ambiguità che va fermata è quella
  //   che può legare la riga all'AZIENDA sbagliata.
  const contattiPerIdentita = new Map<string, number>();
  const aziendePerContatto = new Map<string, Set<string>>();
  for (const co of coppie) {
    const kI = `${chiaveIdentita(co.identita)}|${co.punteggio}`;
    contattiPerIdentita.set(kI, (contattiPerIdentita.get(kI) ?? 0) + 1);
    const kC = `${co.contatto.id}|${co.punteggio}`;
    const aziende = aziendePerContatto.get(kC);
    if (aziende) aziende.add(co.identita.companyId);
    else aziendePerContatto.set(kC, new Set([co.identita.companyId]));
  }
  for (const co of coppie) {
    const kI = `${chiaveIdentita(co.identita)}|${co.punteggio}`;
    const kC = `${co.contatto.id}|${co.punteggio}`;
    co.ambigua =
      (contattiPerIdentita.get(kI) ?? 0) > 1 ||
      (aziendePerContatto.get(kC)?.size ?? 0) > 1;
  }

  coppie.sort(
    (a, b) => {
      if (b.punteggio !== a.punteggio) return b.punteggio - a.punteggio;
      const timeA = a.contatto.createdAt.getTime();
      const timeB = b.contatto.createdAt.getTime();
      if (timeA !== timeB) return timeA - timeB;
      const idA = a.contatto.id;
      const idB = b.contatto.id;
      if (idA !== idB) return idA < idB ? -1 : 1;
      // Stesso contatto, stesso punteggio: se una delle due identità è una
      // sede e l'altra la madre, vince la sede (vedi commento in testa al
      // file). Regola esplicita, non delegata all'ordine delle chiavi.
      const sedeA = a.identita.sedeId !== null;
      const sedeB = b.identita.sedeId !== null;
      if (sedeA !== sedeB) return sedeA ? -1 : 1;
      const kA = chiaveIdentita(a.identita);
      const kB = chiaveIdentita(b.identita);
      return kA < kB ? -1 : kA > kB ? 1 : 0;
    },
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
