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
 */
export type SedeScope = { scopeIds: string[]; aggregate: boolean };

type CtxLike = {
  isOwner: boolean;
  scopeIds: string[];
  currentSede: { kind: 'ALL' } | { kind: 'ONE'; sede: { id: string } } | null;
};

export function toSedeScope(ctx: CtxLike): SedeScope {
  return {
    scopeIds: ctx.scopeIds,
    aggregate: ctx.isOwner && ctx.currentSede?.kind === 'ALL',
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

export function wherePraticaAttiva(
  scope: SedeScope,
  args: { companyId: string; ruolo: 'AGENZIA' | 'DEALER' },
): Prisma.PraticaWhereInput {
  const base: Prisma.PraticaWhereInput =
    args.ruolo === 'AGENZIA'
      ? { agenziaAssegnataId: args.companyId, deletedAt: null }
      : { brokerId: args.companyId, deletedAt: null };
  if (scope.aggregate) return base;
  return args.ruolo === 'AGENZIA'
    ? { ...base, agenziaSedeId: { in: scope.scopeIds } }
    : { ...base, brokerSedeId: { in: scope.scopeIds } };
}

export function whereAssegnazionePending(
  scope: SedeScope,
  agenziaId: string,
): Prisma.PraticaAssegnazioneWhereInput {
  const base: Prisma.PraticaAssegnazioneWhereInput = { agenziaId, esito: 'PENDING' };
  if (scope.aggregate) return base;
  return { ...base, sedeId: { in: scope.scopeIds } };
}

/**
 * `DocumentoFiscale` non ha colonna sede (P.IVA unica: il documento è
 * dell'entità legale). Si scopa via relazione: la pratica che l'ha generato,
 * oppure il wallet del payout per i documenti broker aggregati. I documenti
 * con nessuno dei due agganci restano visibili al solo owner aggregato.
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
  return {
    AND: [base, { OR: [perPratica, { payout: { wallet: { sedeId: { in: scope.scopeIds } } } }] }],
  };
}
