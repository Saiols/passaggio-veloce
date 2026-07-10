import { conDipendenze, permessiPerTipo, type CompanyTypeP, type Permesso } from './catalogo';

/**
 * Esito della validazione di una membership di sede per il backfill.
 * La decisione pura racchiude il ramo di sicurezza che era inline nello script.
 */
export type DecisioneMembership =
  | { azione: 'scrivi'; ruolo: 'ADMIN_SEDE' | 'OPERATORE' }
  | { azione: 'salta'; motivo: string };

/**
 * Un utente non-owner deve avere esattamente una membership di sede.
 * L'invariante è imposta dal codice applicativo, non dal DB: `@@unique([userId, sedeId])`
 * vincola la coppia, non `userId` da solo. Se il dato la viola, non indoviniamo:
 * saltiamo e lo diciamo. Scrivere i permessi della riga sbagliata sarebbe
 * un'escalation silenziosa.
 */
export function decidiMembership(membership: readonly { ruolo: string }[]): DecisioneMembership {
  if (membership.length === 0) {
    return { azione: 'salta', motivo: 'nessuna membership di sede' };
  }

  if (membership.length > 1) {
    return {
      azione: 'salta',
      motivo: `${membership.length} membership di sede (atteso 1)`,
    };
  }

  const ruolo = membership[0].ruolo;
  if (ruolo === 'ADMIN_SEDE' || ruolo === 'OPERATORE') {
    return { azione: 'scrivi', ruolo };
  }

  return {
    azione: 'salta',
    motivo: `ruolo di sede sconosciuto: ${ruolo}`,
  };
}

/**
 * Permessi da assegnare agli utenti che esistevano prima dell'introduzione del
 * sistema: fotografano ciò che potevano fare. Niente `pagamenti.*` qui: non
 * sono capability delegabili né oggi né mai (D1/D4 di
 * docs/superpowers/specs/2026-07-10-iban-solo-super-admin-design.md) — l'IBAN
 * resta owner-only via `isOwner`, il retry dell'addebito resta aperto a tutti
 * senza gate, quindi nessuno dei due compare più nel catalogo.
 */
const OPERATORE: Record<CompanyTypeP, Permesso[]> = {
  DEALER: [
    'pratiche.view',
    'pratiche.create',
    'pratiche.annulla',
    'pratiche.valuta',
    'pratiche.download',
    'fatture.view',
    'fatture.download',
    'fatture.xml',
    'wallet.view',
    'affiliazione.view',
    'notifiche.view',
  ],
  AGENZIA: [
    'pratiche.view',
    'pratiche.processa',
    'pratiche.firma',
    'pratiche.segnala',
    'pratiche.download',
    'inbox.view',
    'inbox.gestisci',
    'fatture.view',
    'fatture.download',
    'fatture.xml',
    'wallet.view',
    'addebiti.view',
    'affiliazione.view',
    'feedback.view',
    'orari.view',
    'notifiche.view',
  ],
};

export function permessiBackfill(
  t: CompanyTypeP,
  ruoloSede: 'ADMIN_SEDE' | 'OPERATORE',
): Permesso[] {
  if (ruoloSede === 'ADMIN_SEDE') return permessiPerTipo(t);
  return conDipendenze(OPERATORE[t]);
}

/**
 * Esito della validazione di un invito PENDING per il backfill.
 *
 * Non riusa `decidiMembership`: per un `User` già creato il ruolo si legge da
 * una membership `UserSede` (una riga per utente, l'invariante che
 * `decidiMembership` verifica); per un `Invitation` non c'è alcuna membership
 * — sede e ruolo sono due CAMPI dell'invito stesso (`sedeId`, `ruoloSede`),
 * valorizzati al momento dell'invio (`createInvitationAction`). Sono forme
 * diverse dello stesso invariante ("un ruolo di sede valido prima di
 * calcolare i permessi"), quindi la decisione resta separata.
 *
 * `sedeId` nullo è l'invito legacy "a livello madre" (pre multi-sede, o
 * un'infarinatura di dati) — non si indovina la sede, si salta. `ruoloSede`
 * è tipizzato non-null nello schema con default `OPERATORE`, quindi in pratica
 * non manca mai; il controllo resta per difesa in profondità (stesso principio
 * di `decidiMembership` col "ruolo di sede sconosciuto") e per accettare
 * l'input come query pura, senza legarlo alla riga esatta del DB.
 */
export function decidiInvito(inv: {
  sedeId: string | null;
  ruoloSede: string | null | undefined;
}): DecisioneMembership {
  if (!inv.sedeId) {
    return { azione: 'salta', motivo: 'invito legacy senza sedeId' };
  }
  if (inv.ruoloSede === 'ADMIN_SEDE' || inv.ruoloSede === 'OPERATORE') {
    return { azione: 'scrivi', ruolo: inv.ruoloSede };
  }
  return { azione: 'salta', motivo: `ruoloSede mancante o sconosciuto: ${inv.ruoloSede}` };
}
