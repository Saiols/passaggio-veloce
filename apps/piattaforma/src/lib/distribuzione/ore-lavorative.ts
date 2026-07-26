/**
 * Giorni della settimana per la distribuzione pratica.
 *
 * Storicamente questo file ospitava anche l'engine "ore lavorative per
 * agenzia" (countdown 4h/round basato sulle fasce orarie dichiarate da ogni
 * sede) — sostituito dal motore v2 (anelli incrementali + gate orario
 * piattaforma di `orario-piattaforma.ts`, Rome-aware via `lib/date/rome-day.ts`).
 * Il tipo `GiornoSettimana` resta qui perché `orario-piattaforma.ts` e
 * `calendario.ts` lo importano ancora: il primo per mappare `getUTCDay()` sul
 * giorno, il secondo per indicizzare le fasce settimanali. `config.ts` non lo
 * importa più — prende il calendario già risolto da `calendario.ts`.
 */
export type GiornoSettimana = 'LUN' | 'MAR' | 'MER' | 'GIO' | 'VEN' | 'SAB' | 'DOM';
