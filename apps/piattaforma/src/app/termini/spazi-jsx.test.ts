import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// `__dirname` non esiste sotto vitest (ESM). Stesso pattern di mappa-pagine.test.ts.
const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // src/app

/**
 * PERCHÉ QUESTO TEST ESISTE
 * =========================
 * Il compilatore JSX/SWC di Next.js mangia lo spazio letterale che segue
 * immediatamente un tag inline di chiusura (`</strong>`, `</em>`, `</a>`,
 * `</code>`) quando il nodo di testo che lo contiene va a capo (contiene un
 * `\n`) prima di raggiungere il tag successivo. Se invece l'intero testo
 * resta su una sola riga, lo spazio sopravvive: non è un bug "sempre", è un
 * bug "quando Prettier va a capo", il che lo rende silenzioso e invisibile
 * a chi legge il sorgente con l'occhio.
 *
 * Caso reale accertato (clausola 10.3 di /termini, prima della correzione):
 *   sorgente:  <strong>respingerla</strong> (pratica prosegue, nessun
 *              addebito). L'esito è comunicato via email a entrambe le
 *              parti.
 *   DOM SSR:   "...respingerla(pratica prosegue, nessun addebito)..."
 * Verificato con `.next` cancellato e ricompilato: deterministico, non un
 * artefatto di cache. In produzione questo produce testo contrattuale
 * incollato (es. "non è partedel contratto", "tra 1 € e 200 €per pratica")
 * in un contratto che gli utenti accettano in fase di registrazione.
 *
 * Il rimedio (già in uso altrove nel file) è rendere lo spazio esplicito:
 * `</strong>{' '}` invece di `</strong> `. La forma corretta non fa match
 * col pattern sotto, perché dopo `>` non c'è più uno spazio letterale.
 *
 * Se questo test torna rosso in futuro: NON cancellarlo. Vuol dire che
 * qualcuno ha riscritto un paragrafo e Prettier ha spostato un a-capo
 * dentro un nodo di testo che segue un tag inline — applica lo stesso
 * rimedio (`{' '}`) al nuovo punto, senza toccare il testo legale.
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
