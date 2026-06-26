/**
 * Parsing/validazione dei campi anagrafici di una Sede — logica pura (niente IO).
 * Condivisa da creazione e modifica sede (app/sedi/actions.ts).
 */

export type SedeFields = {
  nome: string;
  indirizzo: string;
  civico: string | null;
  citta: string;
  cap: string;
  provincia: string;
  telefono: string | null;
  email: string | null;
  codiceInterno: string | null;
  iban: string | null;
  payoutThresholdCent: number;
};

const IBAN_IT = /^IT\d{2}[A-Z0-9]{1,30}$/i;
/** Default soglia payout = €1000 (allineato a Sede.payoutThresholdCent @default). */
const DEFAULT_PAYOUT_CENT = 100_000;

export function parseSedeFields(
  raw: Record<string, string | undefined>,
): { ok: true; data: SedeFields } | { ok: false; error: string } {
  const t = (k: string): string => (raw[k] ?? '').trim();

  const nome = t('nome');
  const indirizzo = t('indirizzo');
  const citta = t('citta');
  const cap = t('cap');
  const provincia = t('provincia').toUpperCase();
  if (!nome || !indirizzo || !citta || !cap || !provincia) {
    return { ok: false, error: 'Nome, indirizzo, città, CAP e provincia sono obbligatori' };
  }
  if (provincia.length !== 2) {
    return { ok: false, error: 'Provincia: sigla di 2 lettere (es. VE)' };
  }

  const iban = t('iban') || null;
  if (iban && !IBAN_IT.test(iban)) {
    return { ok: false, error: 'IBAN italiano non valido' };
  }

  // Soglia payout: euro (decimale con . o ,) → cent. Assente → default.
  let payoutThresholdCent = DEFAULT_PAYOUT_CENT;
  const euroRaw = t('payoutThresholdEuro');
  if (euroRaw !== '') {
    const euro = Number(euroRaw.replace(',', '.'));
    if (!Number.isFinite(euro) || euro < 0) {
      return { ok: false, error: 'Soglia payout non valida' };
    }
    payoutThresholdCent = Math.round(euro * 100);
  }

  return {
    ok: true,
    data: {
      nome,
      indirizzo,
      citta,
      cap,
      provincia,
      civico: t('civico') || null,
      telefono: t('telefono') || null,
      email: t('email') || null,
      codiceInterno: t('codiceInterno') || null,
      iban,
      payoutThresholdCent,
    },
  };
}
