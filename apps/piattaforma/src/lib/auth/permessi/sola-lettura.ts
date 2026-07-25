import { type Permesso } from './catalogo';

/**
 * Partizione delle 31 chiavi del catalogo fra ciò che un utente SOSPESO
 * conserva e ciò che perde. Spec:
 * docs/superpowers/specs/2026-07-25-sospensione-sola-lettura-design.md
 *
 * Le due liste sono entrambe esplicite di proposito: se la seconda fosse il
 * complemento della prima, una chiave nuova nel catalogo diventerebbe di
 * scrittura in silenzio e nessun test diventerebbe rosso. Il test
 * «lettura e scrittura insieme coprono esattamente il catalogo» costringe a
 * decidere. A runtime `isLettura` resta comunque fail-closed.
 */
export const PERMESSI_LETTURA = [
  'pratiche.view',
  'pratiche.download',
  'inbox.view',
  'wallet.view',
  'fatture.view',
  'fatture.download',
  'fatture.xml',
  'addebiti.view',
  'affiliazione.view',
  'feedback.view',
  'sede.view',
  'orari.view',
  'team.view',
  'notifiche.view',
] as const satisfies readonly Permesso[];

/**
 * I download restano in lettura (`pratiche.download`, `fatture.download`,
 * `fatture.xml`): sono dati propri dell'azienda, e negarne l'estrazione durante
 * una sospensione sarebbe difficile da difendere anche sul piano GDPR.
 */
export const PERMESSI_SCRITTURA = [
  'pratiche.create',
  'pratiche.annulla',
  'pratiche.valuta',
  'pratiche.processa',
  'pratiche.firma',
  'pratiche.segnala',
  'inbox.gestisci',
  'wallet.payout',
  'wallet.soglia',
  'sede.edit',
  'orari.edit',
  'team.invita',
  'team.crea',
  'team.modifica',
  'team.reset_password',
  'team.disabilita',
  'team.permessi',
] as const satisfies readonly Permesso[];

const LETTURA: ReadonlySet<Permesso> = new Set<Permesso>(PERMESSI_LETTURA);

/** Fail-closed: ciò che non è nella whitelist è scrittura, chiavi ignote comprese. */
export function isLettura(p: Permesso): boolean {
  return LETTURA.has(p);
}

/** Nuovo set con le sole chiavi di lettura. Non muta l'ingresso. */
export function filtraSoloLettura(permessi: Set<Permesso>): Set<Permesso> {
  return new Set([...permessi].filter((p) => LETTURA.has(p)));
}
