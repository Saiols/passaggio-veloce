import type { TipoSoggetto } from '@/lib/documenti/engine';
import type { IntestatarioPrefill } from './venditori-per-veicolo';

/**
 * Campi minimi di un venditore usati dalla riconciliazione col prefill OCR.
 * VenditoreInput (wizard.tsx) è un superset: l'identità e i verdetti OCR non
 * sono letti qui direttamente ma via `hasIdentita` (per non accoppiare questo
 * modulo puro/testabile alle BlobRef del client).
 */
export type VendCore = {
  id: string;
  veicoloOrdine: number;
  isPG: boolean;
  tipoSoggetto: TipoSoggetto | null;
  nome: string;
  cognome: string;
  cf: string;
  ragioneSociale: string;
  piva: string;
  telefono: string;
  email: string;
};

const norm = (s: string | null | undefined): string => (s ?? '').trim().toUpperCase();

/** Display "COGNOME NOME" (persona) o ragione sociale (PG), normalizzato. */
function vendDisplay(v: VendCore): string {
  if (v.isPG) return norm(v.ragioneSociale);
  return `${norm(v.cognome)} ${norm(v.nome)}`.trim();
}

/** True se il venditore corrisponde all'intestatario OCR (per CF se presente,
 *  altrimenti per display). */
function ownerMatches(v: VendCore, o: IntestatarioPrefill): boolean {
  const vcf = norm(v.cf);
  const ocf = norm(o.cf);
  if (vcf && ocf) return vcf === ocf;
  const vd = vendDisplay(v);
  const od = norm(o.display);
  return !!vd && vd === od;
}

/** Semina i campi anagrafici del venditore dall'intestatario OCR, preservando
 *  id/veicoloOrdine e tutti gli altri campi di `base` (identità, contatti…). */
function seed<V extends VendCore>(base: V, o: IntestatarioPrefill): V {
  return {
    ...base,
    veicoloOrdine: o.veicoloOrdine,
    isPG: o.isPersonaGiuridica,
    tipoSoggetto: o.isPersonaGiuridica ? 'AZIENDA' : base.tipoSoggetto,
    nome: o.nome ?? '',
    cognome: o.cognome ?? '',
    cf: (o.cf ?? '').toUpperCase(),
    ragioneSociale: o.ragioneSociale ?? '',
    piva: o.piva ?? '',
  };
}

/**
 * Riconcilia l'array venditori con gli intestatari estratti dall'OCR dei
 * libretti, in modo NON distruttivo (fix bug #1/#3/#4):
 *
 * - per ogni veicolo con intestatari OCR: ogni intestatario viene abbinato a un
 *   venditore esistente (per identità), che viene RIUSATO così com'è (preserva
 *   documenti/verdetti/contatti/edit manuali). Se non c'è un match ma esiste un
 *   venditore "vuoto" (default o placeholder senza dati) lo si semina; altrimenti
 *   si crea un nuovo venditore seminato.
 * - i venditori esistenti con dati (co-intestatari aggiunti a mano o modificati)
 *   che non corrispondono ad alcun intestatario vengono comunque PRESERVATI.
 * - i venditori di veicoli SENZA intestatari OCR (foglio complementare, OCR
 *   transitorio non pronto, gruppo solo-manuale) restano intatti.
 *
 * Non rimuove mai un venditore che porta dati: al più lascia un doppione che il
 * broker può rimuovere a mano (il cross-check segnalerà l'eventuale mismatch).
 * Molto meglio della perdita silenziosa di documenti KYC del comportamento
 * precedente (rimpiazzo totale dell'array ad ogni cambio firma OCR).
 */
export function reconcileVenditori<V extends VendCore>(
  prev: V[],
  prefill: IntestatarioPrefill[],
  opts: {
    makeEmpty: (veicoloOrdine: number) => V;
    hasIdentita: (v: V) => boolean;
  },
): V[] {
  const { makeEmpty, hasIdentita } = opts;

  const hasData = (v: V): boolean =>
    !!(
      norm(v.nome) ||
      norm(v.cognome) ||
      norm(v.cf) ||
      norm(v.ragioneSociale) ||
      norm(v.piva) ||
      v.telefono.trim() ||
      v.email.trim() ||
      hasIdentita(v)
    );
  const isBlank = (v: V): boolean => !hasData(v);

  const ordiniPrefill = Array.from(new Set(prefill.map((o) => o.veicoloOrdine))).sort(
    (a, b) => a - b,
  );
  const used = new Set<string>();
  const out: V[] = [];

  for (const ord of ordiniPrefill) {
    const owners = prefill.filter((o) => o.veicoloOrdine === ord);
    const existing = prev.filter((v) => v.veicoloOrdine === ord);
    for (const o of owners) {
      // 1) match per identità a un venditore esistente non ancora usato
      let match = existing.find((v) => !used.has(v.id) && ownerMatches(v, o));
      // 2) altrimenti consuma un venditore vuoto come bersaglio da seminare
      if (!match) match = existing.find((v) => !used.has(v.id) && isBlank(v));
      if (match) {
        used.add(match.id);
        out.push(isBlank(match) ? seed(match, o) : match);
      } else {
        out.push(seed(makeEmpty(ord), o));
      }
    }
    // 3) preserva i venditori con dati non abbinati (co-intestatari manuali/edit)
    for (const v of existing) {
      if (!used.has(v.id) && hasData(v)) {
        used.add(v.id);
        out.push(v);
      }
    }
  }

  // 4) veicoli senza intestatari OCR: preserva i loro venditori invariati
  const ordiniConPrefill = new Set(ordiniPrefill);
  for (const v of prev) {
    if (!ordiniConPrefill.has(v.veicoloOrdine)) out.push(v);
  }

  return out;
}
