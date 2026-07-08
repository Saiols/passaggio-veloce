import type { Prisma } from '@pv/db';

/**
 * Scoping sede per le query operative — logica pura (niente IO).
 *
 * `aggregate = true` SOLO per il proprietario in vista aggregata ("ALL"): vede
 * l'intero gruppo, comprese le righe legacy con sede NULL. In tutti gli altri
 * casi si filtra per `scopeIds` — fail-closed: lista vuota ⇒ nessuna riga.
 *
 * Il filtro sulla company NON viene mai rimosso: la sede restringe la madre,
 * non la sostituisce (una sede compromessa non può leggere altre aziende).
 *
 * ATTENZIONE — asimmetria voluta tra i predicati qui sotto: `wherePraticaAttiva`
 * e `whereAssegnazionePending` NON hanno un ramo `aggregate` perché le pagine
 * che i loro conteggi rispecchiano (`/pratiche`, `/inbox`) filtrano SEMPRE per
 * `scopeIds`, anche per l'owner. Gli altri predicati (`whereFeeAddebito`,
 * `whereValutazione`, `whereDocumentoFiscale`) mantengono il ramo `aggregate`
 * perché le loro pagine mostrano davvero tutta la madre all'owner. Non
 * "uniformare" questi due gruppi: renderebbe badge e lista di nuovo divergenti.
 */
export type SedeScope = { scopeIds: string[]; aggregate: boolean; isOwner: boolean };

/** Scope fail-closed per contesti senza sessione: nessuna sede, nessun privilegio. */
export const NO_SEDE_SCOPE: SedeScope = { scopeIds: [], aggregate: false, isOwner: false };

type CtxLike = {
  isOwner: boolean;
  scopeIds: string[];
  currentSede: { kind: 'ALL' } | { kind: 'ONE'; sede: { id: string } } | null;
};

export function toSedeScope(ctx: CtxLike): SedeScope {
  return {
    scopeIds: ctx.scopeIds,
    aggregate: ctx.isOwner && ctx.currentSede?.kind === 'ALL',
    isOwner: ctx.isOwner,
  };
}

export function whereFeeAddebito(scope: SedeScope, companyId: string): Prisma.FeeAddebitoWhereInput {
  if (scope.aggregate) return { agenziaId: companyId };
  return { agenziaId: companyId, agenziaSedeId: { in: scope.scopeIds } };
}

export function whereValutazione(scope: SedeScope, agenziaId: string): Prisma.ValutazioneWhereInput {
  if (scope.aggregate) return { agenziaId };
  return { agenziaId, agenziaSedeId: { in: scope.scopeIds } };
}

/**
 * Niente ramo `aggregate`: filtra SEMPRE per `scopeIds`, anche per l'owner in
 * vista ALL. La lista corrispondente (`/pratiche`) filtra sempre per sede, un
 * badge senza filtro conterebbe righe che la lista non mostra ("numerino
 * pieno, lista vuota").
 */
export function wherePraticaAttiva(
  scope: SedeScope,
  args: { companyId: string; ruolo: 'AGENZIA' | 'DEALER' },
): Prisma.PraticaWhereInput {
  const base: Prisma.PraticaWhereInput =
    args.ruolo === 'AGENZIA'
      ? { agenziaAssegnataId: args.companyId, deletedAt: null }
      : { brokerId: args.companyId, deletedAt: null };
  return args.ruolo === 'AGENZIA'
    ? { ...base, agenziaSedeId: { in: scope.scopeIds } }
    : { ...base, brokerSedeId: { in: scope.scopeIds } };
}

/**
 * Niente ramo `aggregate`: filtra SEMPRE per `scopeIds`, anche per l'owner in
 * vista ALL. La lista corrispondente (`/inbox`) filtra sempre per sede, un
 * badge senza filtro conterebbe righe che la lista non mostra ("numerino
 * pieno, lista vuota").
 */
export function whereAssegnazionePending(
  scope: SedeScope,
  agenziaId: string,
): Prisma.PraticaAssegnazioneWhereInput {
  return { agenziaId, esito: 'PENDING', sedeId: { in: scope.scopeIds } };
}

/**
 * `DocumentoFiscale` non ha colonna sede (P.IVA unica: il documento è
 * dell'entità legale). Si scopa via relazione: la pratica che l'ha generato,
 * oppure il wallet del payout per i documenti broker aggregati. I documenti
 * senza nessuno dei due agganci sono dell'entità legale e restano visibili al
 * solo proprietario — in vista aggregata come in vista su singola sede.
 */
export function whereDocumentoFiscale(
  scope: SedeScope,
  args: { companyId: string; ruolo: 'AGENZIA' | 'DEALER' },
): Prisma.DocumentoFiscaleWhereInput {
  const base: Prisma.DocumentoFiscaleWhereInput =
    args.ruolo === 'AGENZIA'
      ? { destinatarioCompanyId: args.companyId }
      : { emittenteCompanyId: args.companyId };
  if (scope.aggregate) return base;
  const perPratica: Prisma.DocumentoFiscaleWhereInput =
    args.ruolo === 'AGENZIA'
      ? { pratica: { agenziaSedeId: { in: scope.scopeIds } } }
      : { pratica: { brokerSedeId: { in: scope.scopeIds } } };
  const payoutSede: Prisma.DocumentoFiscaleWhereInput = {
    payout: { wallet: { sedeId: { in: scope.scopeIds } } },
  };
  // Un documento senza alcuna sede (es. DOC_BROKER del payout sul wallet madre:
  // nessuna pratica, wallet della madre) non appartiene a nessuna filiale: è
  // dell'entità legale, quindi lo vede solo il proprietario — anche quando ha
  // selezionato una singola sede.
  const senzaSede: Prisma.DocumentoFiscaleWhereInput = {
    AND: [
      { OR: [{ praticaId: null }, { pratica: { agenziaSedeId: null, brokerSedeId: null } }] },
      { OR: [{ payoutId: null }, { payout: { wallet: { sedeId: null } } }] },
    ],
  };
  return {
    AND: [base, { OR: [perPratica, payoutSede, ...(scope.isOwner ? [senzaSede] : [])] }],
  };
}
