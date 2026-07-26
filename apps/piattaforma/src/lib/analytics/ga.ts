import { hasAnalyticsConsent } from './consent';

/**
 * Measurement ID della proprietà GA4 (`G-XXXXXXXXXX`).
 *
 * Letto direttamente da `process.env` e non da `@/env`: questo modulo finisce
 * nel bundle client e oggi nessun componente client importa lo schema t3-env.
 * Next sostituisce staticamente i `NEXT_PUBLIC_*` a build time, quindi la
 * costante è già risolta quando arriva al browser. La variabile è comunque
 * dichiarata anche in `src/env.ts` (sezione `client`), che ne valida il formato
 * all'avvio: lì sta la validazione, qui la lettura.
 *
 * Assente o vuota ⇒ **GA non viene caricato affatto**, nemmeno col consenso.
 * È la condizione normale finché la proprietà GA4 non esiste: non serve
 * commentare codice né mettere flag, basta non impostare la variabile.
 */
export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? '';

/** `G-` seguito da lettere/cifre: scarta placeholder e ID incollati male. */
export function isValidMeasurementId(id: string): boolean {
  return /^G-[A-Z0-9]{4,}$/.test(id);
}

/**
 * Le due condizioni che devono valere ENTRAMBE perché lo script di Google
 * venga montato: un ID valido e il consenso analytics prestato.
 *
 * Tenuta fuori dal componente apposta: è la regola che il resto del progetto
 * deve poter verificare senza montare React, ed è l'unico punto in cui
 * "tracciamo o no" viene deciso.
 */
export function shouldLoadGa(args: { measurementId: string; consentRaw: string | null }): boolean {
  return isValidMeasurementId(args.measurementId) && hasAnalyticsConsent(args.consentRaw);
}

/**
 * Nome del flag globale con cui gtag.js si auto-disabilita
 * (`window['ga-disable-G-XXXX'] = true`). Serve per la revoca DOPO il
 * caricamento: lo script resta in pagina per quella sessione, ma smette di
 * inviare hit. Senza, "revoca il consenso" sarebbe un bottone che non fa nulla
 * fino al reload — e l'art. 7.3 GDPR vuole che revocare sia facile quanto
 * acconsentire.
 */
export function gaDisableFlag(measurementId: string): string {
  return `ga-disable-${measurementId}`;
}

/**
 * Cookie di prima parte scritti da GA4: `_ga` (client id, 2 anni) e
 * `_ga_<CONTAINER>` (stato di sessione). Li elenchiamo per poterli cancellare
 * alla revoca e per tenere allineata la cookie policy, che deve nominarli.
 */
export const GA_COOKIE_PREFIXES = ['_ga', '_gid'] as const;

/**
 * Nomi dei cookie GA presenti in una stringa `document.cookie`. Best-effort e
 * per prefisso: il suffisso di `_ga_<CONTAINER>` dipende dalla proprietà, e
 * non vogliamo che la cancellazione dipenda dall'aver indovinato il container.
 */
export function gaCookieNames(cookieString: string): string[] {
  return cookieString
    .split(';')
    .map((c) => c.split('=')[0]?.trim() ?? '')
    .filter((name) => GA_COOKIE_PREFIXES.some((p) => name === p || name.startsWith(`${p}_`)));
}
