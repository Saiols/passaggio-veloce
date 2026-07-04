import type { OwnerInfo } from '@/lib/providers/ocr/types';
import { venditoriCrossCheck } from '@/lib/kyc/match';

export type IntestatarioPrefill = OwnerInfo & { veicoloOrdine: number };

/**
 * Un intestatario-prefill per ciascun proprietario di ciascun veicolo (NO dedup),
 * taggato col veicoloOrdine (1..n). Lo stesso intestatario su più veicoli compare
 * una volta per veicolo.
 */
export function intestatariPerVeicolo(
  veicoli: { ocr?: { proprietariInfo?: OwnerInfo[] } }[],
): IntestatarioPrefill[] {
  const out: IntestatarioPrefill[] = [];
  veicoli.forEach((v, i) => {
    for (const o of v.ocr?.proprietariInfo ?? []) out.push({ ...o, veicoloOrdine: i + 1 });
  });
  return out;
}

type VendMin = {
  veicoloOrdine: number;
  isPG: boolean;
  nome?: string | null;
  cognome?: string | null;
  ragioneSociale?: string | null;
};

/**
 * Cross-check insiemistico venditori ↔ intestatari applicato PER VEICOLO.
 * 'MISMATCH' se un qualsiasi veicolo (con proprietari noti) non combacia;
 * 'SCONOSCIUTO' se nessun veicolo ha proprietari noti; altrimenti 'OK'.
 */
export function crossCheckPerVeicolo(
  venditori: VendMin[],
  proprietariPerVeicolo: Record<number, string[]>,
  opts: { flagProcura?: boolean } = {},
): 'OK' | 'MISMATCH' | 'SCONOSCIUTO' {
  const flagProcura = opts.flagProcura ?? false;
  // Include ANCHE i veicoli con intestatari noti ma SENZA alcun venditore
  // assegnato (bug #8): un veicolo così non veniva mai controllato e passava
  // come OK (venduto senza venditore dichiarato). Ora finisce in venditoriCrossCheck
  // con gruppo vuoto → MISMATCH, e blocca il submit.
  const ordini = new Set<number>([
    ...venditori.map((v) => v.veicoloOrdine),
    ...Object.keys(proprietariPerVeicolo).map(Number),
  ]);
  let qualcheNoto = false;
  for (const ord of ordini) {
    const proprietari = proprietariPerVeicolo[ord] ?? [];
    if (!proprietari.length) continue;
    qualcheNoto = true;
    const gruppo = venditori
      .filter((v) => v.veicoloOrdine === ord)
      .map((v) => ({
        isPersonaGiuridica: v.isPG,
        nome: v.nome ?? undefined,
        cognome: v.cognome ?? undefined,
        ragioneSociale: v.ragioneSociale ?? undefined,
      }));
    if (venditoriCrossCheck(gruppo, proprietari, { flagProcura }) === 'MISMATCH') {
      return 'MISMATCH';
    }
  }
  return qualcheNoto ? 'OK' : 'SCONOSCIUTO';
}
