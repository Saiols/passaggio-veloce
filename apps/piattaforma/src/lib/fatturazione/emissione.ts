import type { Prisma, FatturaPaTipo } from '@pv/db';

/**
 * Stato di emissione di un documento fiscale. NON è uno stato del DB: la
 * piattaforma non trasmette allo SdI (lo fa il commercialista, fuori
 * piattaforma) e tiene solo il flag di tracciamento `trasmessoSdiAt`, alzato a
 * mano dall'admin (app/fatturazione/actions.ts:19).
 *
 * Tre stati, non due: `fatturaPaTipo` è `null` quando il documento NON deve
 * finire allo SdI (calcolo.ts:31-47) — DOC_BROKER di un broker in regime
 * PRIVATO e PENALE_BROKER, fuori campo IVA ex art. 15 D.P.R. 633/1972
 * (clausola 10.4b dei Termini). Trattarli come "da emettere" manderebbe il
 * commercialista a emettere documenti che non devono esistere.
 *
 * Non confondere con `StatoSdi` (provider/types.ts): quello è lo stato di
 * trasmissione restituito da un provider, oggi codice non raggiunto.
 */
export type StatoEmissione = 'DA_EMETTERE' | 'EMESSA' | 'FUORI_SDI';

export function statoEmissione(doc: {
  fatturaPaTipo: FatturaPaTipo | null;
  trasmessoSdiAt: Date | null;
}): StatoEmissione {
  if (doc.trasmessoSdiAt) return 'EMESSA';
  if (doc.fatturaPaTipo == null) return 'FUORI_SDI';
  return 'DA_EMETTERE';
}

const LABEL: Record<StatoEmissione, string> = {
  DA_EMETTERE: 'Da emettere',
  EMESSA: 'Emessa',
  FUORI_SDI: 'Fuori campo SdI',
};

export function labelEmissione(s: StatoEmissione): string {
  return LABEL[s];
}

/**
 * Clausola Prisma del filtro `?emissione=`. Un valore non riconosciuto (URL
 * manomesso) non filtra nulla, come in `whereStato`: meglio mostrare tutto che
 * mostrare una lista vuota inspiegabile.
 *
 * `FUORI_SDI` non è filtrabile: non è una coda di lavoro, è una constatazione.
 * Quei documenti restano visibili in "Tutte", col loro chip.
 */
export function whereEmissione(
  param: string | undefined,
): Prisma.DocumentoFiscaleWhereInput | undefined {
  if (param === 'DA_EMETTERE') return { fatturaPaTipo: { not: null }, trasmessoSdiAt: null };
  if (param === 'EMESSA') return { trasmessoSdiAt: { not: null } };
  return undefined;
}
