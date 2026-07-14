import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// `__dirname` non esiste sotto vitest (ESM). Stesso pattern di mappa-pagine.test.ts.
const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // src/app

/**
 * PERCHÉ QUESTO TEST ESISTE
 * =========================
 * Il difetto è REALE e OSSERVATO sul DOM renderizzato (SSR) di /termini: in
 * produzione sono state trovate **21 parole incollate** dove il sorgente
 * aveva uno spazio letterale subito dopo un tag inline di chiusura
 * (`</strong>`, `</em>`, `</a>`, `</code>`) e il nodo di testo che lo
 * conteneva andava a capo prima del tag successivo. Esempi reali:
 * "non è partedel contratto" (clausola 1) e
 * "respingerla(pratica prosegue, nessun addebito)" (clausola 10.3, sorgente:
 * `<strong>respingerla</strong> (pratica prosegue, nessun\naddebito)...`).
 * Verificato con `.next` cancellato e ricompilato: deterministico, non un
 * artefatto di cache.
 *
 * QUELLO CHE NON SAPPIAMO: la review ha dimostrato che "tag di chiusura +
 * spazio letterale + testo che va a capo" NON è una regola generale — sono
 * stati trovati due casi con esattamente quella forma che danno esito
 * opposto (in uno lo spazio sparisce, nell'altro sopravvive). La condizione
 * esatta che fa scattare il difetto non è stata ridotta a una regola
 * precisa, e non vale la pena inseguirla: costerebbe più di quel che vale.
 *
 * Per questo il pattern qui sotto è VOLUTAMENTE CONSERVATIVO (una
 * sovra-approssimazione in direzione sicura): segnala OGNI occorrenza con
 * quella forma, anche quelle che di per sé renderebbero correttamente. Va
 * bene così, perché il rimedio è innocuo in entrambi i casi: rendere lo
 * spazio esplicito con `{' '}` produce lo stesso identico output di uno
 * spazio letterale che sarebbe comunque sopravvissuto. Un falso positivo qui
 * non costa nulla; un falso negativo costerebbe un contratto pubblico con
 * parole incollate.
 *
 * Il rimedio (già in uso altrove nel file) è rendere lo spazio esplicito:
 * `</strong>{' '}` invece di `</strong> `. La forma corretta non fa match
 * col pattern sotto, perché dopo `>` non c'è più uno spazio letterale.
 *
 * ATTENZIONE — non far girare Prettier (né altri formatter automatici) sulle
 * pagine elencate in PAGINE_LEGALI: il reflow automatico sposta gli a-capo
 * dentro i nodi di testo e può reintrodurre il difetto in un punto diverso
 * da quello corretto qui. Le pagine legali si editano a mano, riga per riga,
 * verificando poi il DOM renderizzato — non basta guardare il sorgente.
 *
 * Se questo test torna rosso in futuro: NON cancellarlo. Vuol dire che
 * qualcuno ha riscritto un paragrafo e ha introdotto (a mano o via
 * formatter) un a-capo dentro un nodo di testo che segue un tag inline —
 * applica lo stesso rimedio (`{' '}`) al nuovo punto, senza toccare il testo
 * legale, e verifica di nuovo il DOM reale.
 */
const PAGINE_LEGALI = [
  'termini/page.tsx',
  'privacy/page.tsx',
  'privacy/clienti/page.tsx',
  'cookie/page.tsx',
];

/**
 * Match: un tag inline di chiusura, seguito da uno o più spazi letterali,
 * seguito dal testo fino al prossimo `<`. Se quel testo contiene un a-capo,
 * lo spazio subito dopo il tag verrà mangiato da SWC in fase di build.
 */
const PATTERN_PERICOLOSO = /<\/(strong|em|a|code)>( +)([^<]*)/g;

/**
 * Seconda variante, cugina della prima e trovata verificando sul DOM reale
 * (non ipotizzata): il tag di chiusura è seguito DIRETTAMENTE da un a-capo
 * (zero spazi letterali sulla sua riga), e il testo riprende sulla riga
 * successiva. Questo è il pitfall JSX "classico" (un nodo di testo fatto
 * solo di spazi bianchi e un a-capo viene rimosso del tutto, non collassato
 * a uno spazio) — distinto dal meccanismo sopra ma con lo stesso sintomo.
 *
 * Caso reale accertato (apertura di /termini, prima della correzione):
 *   sorgente:  <strong>Passaggio Veloce S.r.l.</strong>
 *              (&laquo;Passaggio Veloce&raquo;, &laquo;noi&raquo;), da parte...
 *   DOM SSR:   "...Passaggio Veloce S.r.l.(«Passaggio Veloce», «noi»)..."
 *
 * Qui però la punteggiatura di chiusura (`.`, `,`, `;`, `)`, `»`) NON vuole
 * uno spazio davanti (è corretto che "assistenza@passaggioveloce.it" seguito
 * da "." o ";" sulla riga dopo resti attaccato) — quindi il pattern scatta
 * solo quando il carattere successivo è una lettera, una cifra o una
 * parentesi aperta `(`: lì una parola reale seguirebbe, e lo spazio serve.
 */
const PATTERN_PERICOLOSO_ACAPO_DIRETTO = /<\/(strong|em|a|code)>\r?\n\s*([\p{L}\p{N}(])/gu;

function trovaOccorrenzePericolose(src: string): string[] {
  const trovate: string[] = [];
  let match: RegExpExecArray | null;
  PATTERN_PERICOLOSO.lastIndex = 0;
  while ((match = PATTERN_PERICOLOSO.exec(src))) {
    const [, tag, , testo] = match;
    if (testo.includes('\n')) {
      const finoAlMatch = src.slice(0, match.index);
      const riga = finoAlMatch.split('\n').length;
      const estratto = match[0].replace(/\n/g, '\\n').slice(0, 90);
      trovate.push(`riga ${riga}: </${tag}> seguito da testo multi-riga → "${estratto}..."`);
    }
  }
  PATTERN_PERICOLOSO_ACAPO_DIRETTO.lastIndex = 0;
  while ((match = PATTERN_PERICOLOSO_ACAPO_DIRETTO.exec(src))) {
    const [, tag, carattere] = match;
    const finoAlMatch = src.slice(0, match.index);
    const riga = finoAlMatch.split('\n').length;
    const estratto = src.slice(match.index, match.index + 70).replace(/\n/g, '\\n');
    trovate.push(
      `riga ${riga}: </${tag}> seguito da a-capo diretto e poi "${carattere}" (nessuno spazio, nessun {' '}) → "${estratto}..."`,
    );
  }
  return trovate;
}

describe('pagine legali: nessuno spazio JSX mangiato dopo un tag inline', () => {
  for (const rel of PAGINE_LEGALI) {
    it(`${rel} non contiene "</tag> testo-che-va-a-capo" senza {' '} esplicito`, () => {
      const src = readFileSync(resolve(APP_DIR, rel), 'utf8');
      const occorrenze = trovaOccorrenzePericolose(src);
      expect(
        occorrenze,
        `${rel}: trovate ${occorrenze.length} occorrenze in cui un tag inline di chiusura ` +
          `(</strong>, </em>, </a>, </code>) è seguito da uno spazio letterale e da un testo che va ` +
          `a capo prima del prossimo tag. SWC mangia quello spazio in fase di build (verificato su SSR ` +
          `reale, vedi commento in cima al file) producendo parole incollate nel contratto pubblico. ` +
          `Correggi scrivendo </tag>{' '} al posto di </tag> seguito dallo spazio, senza toccare il testo:\n  ` +
          occorrenze.join('\n  '),
      ).toEqual([]);
    });
  }
});
