/**
 * Giorni della settimana per la distribuzione pratica.
 *
 * Storicamente questo file ospitava anche l'engine "ore lavorative per
 * agenzia" (countdown 4h/round basato sulle fasce orarie dichiarate da ogni
 * sede) — sostituito dal motore v2 (anelli incrementali + gate orario
 * piattaforma di `orario-piattaforma.ts`, Rome-aware via `lib/date/rome-day.ts`).
 * Il tipo `GiornoSettimana` resta qui perché `orario-piattaforma.ts` e
 * `config.ts` lo importano ancora per validare i giorni di apertura.
 */
export type GiornoSettimana = 'LUN' | 'MAR' | 'MER' | 'GIO' | 'VEN' | 'SAB' | 'DOM';
