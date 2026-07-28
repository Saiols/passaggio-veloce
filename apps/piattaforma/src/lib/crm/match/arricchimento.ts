/**
 * Cosa scrivere su un contatto CRM quando l'azienda che gli corrisponde si è
 * registrata. Modulo PURO: niente server-only, niente Prisma.
 *
 * Regola unica e non negoziabile: si riempiono SOLO i campi vuoti. Il dato
 * raccolto al telefono da un venditore vale più di quello scritto in
 * registrazione, e riconciliare due valori diversi è una decisione umana —
 * il suo posto è il form del contatto, non un cron notturno.
 */
import { normalizeTel } from './normalize';
import { crmNormFields, type CrmNormFields } from './norm-fields';
import { regioneDaProvincia } from '@/lib/geo/province';

export type CampoArricchibile =
  | 'email' | 'wa' | 'piva' | 'indirizzo' | 'citta' | 'cap' | 'regione';

/**
 * Ordine canonico: decide come si legge `arricchitoDa` e in che ordine
 * compaiono i campi nel badge. `tel` e `nome` non ci sono perché su
 * `CrmContact` sono obbligatori: non hanno buchi da riempire.
 */
export const CAMPI_ARRICCHIBILI = [
  'email', 'wa', 'piva', 'indirizzo', 'citta', 'cap', 'regione',
] as const satisfies readonly CampoArricchibile[];

export type ContattoDaArricchire = Record<CampoArricchibile, string | null>;

/**
 * Lo `select` Prisma dei campi che servono sia a calcolare la patch sia a
 * fare il compare-and-set. FONTE UNICA: `apply.ts` e `sync.ts` lo importano,
 * non lo riscrivono. Un campo aggiunto qui e ricopiato a mano là si perde in
 * silenzio in uno dei due percorsi.
 */
export const SELECT_ARRICCHIMENTO = {
  email: true, wa: true, piva: true,
  indirizzo: true, citta: true, cap: true, regione: true,
  arricchitoDa: true,
} as const;

export type AnagraficaSorgente = {
  email: string | null;
  telefono: string | null;
  indirizzo: string;
  civico: string | null;
  citta: string;
  cap: string;
  provincia: string;
};

/**
 * L'identità registrata. `pec` non c'è di proposito: resta chiave di match in
 * `identita.ts`, ma non è un indirizzo a cui un venditore scrive.
 */
export type SorgenteArricchimento = {
  company: AnagraficaSorgente & { partitaIva: string };
  sede: AnagraficaSorgente | null;
};

export type PatchArricchimento = {
  /** Solo i campi da scrivere, già pronti per Prisma. */
  dati: Partial<Record<CampoArricchibile, string>>;
  /** Gli stessi campi come elenco: guardia CAS + audit. */
  campi: CampoArricchibile[];
};

const vuoto = (v: string | null | undefined): boolean => !v || v.trim() === '';

/** Il primo valore non vuoto, già ripulito. `''` se non ce ne sono. */
const primo = (...valori: Array<string | null | undefined>): string =>
  valori.find((v) => !vuoto(v))?.trim() ?? '';

/**
 * Cellulare italiano: la chiave normalizzata inizia per 3. `normalizeTel` ha
 * già tolto il prefisso internazionale, quindi '+39 333 1234567' e
 * '333 1234567' danno entrambi '3331234567'; un fisso dà '024478712'.
 */
const isCellulare = (raw: string | null | undefined): boolean =>
  normalizeTel(raw).startsWith('3');

/** 'Via Fiume' + '6' → 'Via Fiume 6'. `CrmContact` non ha il campo civico. */
const componiIndirizzo = (a: Pick<AnagraficaSorgente, 'indirizzo' | 'civico'>): string =>
  [a.indirizzo, a.civico].map((p) => p?.trim() ?? '').filter(Boolean).join(' ');

export function campiVuoti(contatto: ContattoDaArricchire): CampoArricchibile[] {
  return CAMPI_ARRICCHIBILI.filter((c) => vuoto(contatto[c]));
}

export function calcolaArricchimento(
  contatto: ContattoDaArricchire,
  sorgente: SorgenteArricchimento,
): PatchArricchimento | null {
  const { company: c, sede: s } = sorgente;

  const candidati: Record<CampoArricchibile, string> = {
    // Sede prima, madre dopo: la riga della lista è un punto vendita.
    // Minuscolo come ogni altro write path del CRM (vedi
    // crm/contatti/actions.ts): `Company.email` può arrivare mista, e senza
    // questo allineamento la colonna cambierebbe da sola al primo salvataggio
    // manuale del contatto, con `arricchitoDa` che continuerebbe a dire che
    // l'ha messa l'iscrizione.
    email: primo(s?.email, c.email).toLowerCase(),
    // Il primo numero MOBILE fra sede e madre: `wa` è la casella WhatsApp,
    // metterci il fisso dell'azienda crea un canale che non esiste.
    wa: [s?.telefono, c.telefono].find((t) => isCellulare(t))?.trim() ?? '',
    // Solo dalla madre: la sede non ha una P.IVA propria.
    piva: c.partitaIva?.trim() ?? '',
    indirizzo: primo(s ? componiIndirizzo(s) : '', componiIndirizzo(c)),
    citta: primo(s?.citta, c.citta),
    cap: primo(s?.cap, c.cap),
    regione: regioneDaProvincia(primo(s?.provincia, c.provincia)) ?? '',
  };

  const dati: Partial<Record<CampoArricchibile, string>> = {};
  const campi: CampoArricchibile[] = [];
  for (const campo of campiVuoti(contatto)) {
    const valore = candidati[campo];
    // Riempire un buco con un altro buco sporca solo l'audit.
    if (vuoto(valore)) continue;
    dati[campo] = valore;
    campi.push(campo);
  }

  return campi.length > 0 ? { dati, campi } : null;
}

/**
 * Le colonne `*Norm` dei soli campi che si stanno scrivendo.
 *
 * `crmNormFields` le calcola tutte e quattro, e le assenti tornano `null`:
 * passarle tutte a Prisma AZZEREREBBE `telNorm` e le altre chiavi di match
 * del contatto. Qui si tiene solo ciò che si scrive davvero.
 */
export function normDaPatch(patch: PatchArricchimento): Partial<CrmNormFields> {
  const tutte = crmNormFields({
    wa: patch.dati.wa,
    email: patch.dati.email,
    piva: patch.dati.piva,
  });
  const out: Partial<CrmNormFields> = {};
  if (patch.dati.wa !== undefined) out.waNorm = tutte.waNorm;
  if (patch.dati.email !== undefined) out.emailNorm = tutte.emailNorm;
  if (patch.dati.piva !== undefined) out.pivaNorm = tutte.pivaNorm;
  return out;
}

/**
 * L'audit si accumula: se oggi si riempie l'email e fra sei mesi l'azienda
 * aggiunge il cellulare, `arricchitoDa` deve dire 'email,wa' — non 'wa'.
 * Le voci non riconosciute vengono scartate dall'ordinamento canonico: la
 * colonna la scrive solo questo modulo, quindi non ce ne sono.
 */
export function unisciArricchitoDa(
  precedente: string | null,
  nuovi: CampoArricchibile[],
): string {
  const visti = new Set<string>([
    ...(precedente ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    ...nuovi,
  ]);
  return CAMPI_ARRICCHIBILI.filter((c) => visti.has(c)).join(',');
}

/**
 * Toglie dall'audit i campi che una modifica a mano ha cambiato.
 *
 * `arricchitoDa` dice al venditore quali dati non gli ha dettati nessuno. Nel
 * momento in cui qualcuno riscrive a mano l'email ereditata, quella riga
 * comincia a mentire: il dato adesso viene dal telefono, non dall'iscrizione.
 * Un audit che mente è peggio di nessun audit, perché lo si legge per decidere
 * di chi fidarsi.
 *
 * Il confronto è sui valori come vengono scritti sul DB (già normalizzati dal
 * write path), quindi un salvataggio che non cambia niente non tocca l'audit.
 * Anche svuotare un campo lo scollega: il valore ereditato non c'è più.
 *
 * Ritorna `null` quando non resta niente, così la colonna torna vuota e il
 * pannello smette di mostrare la riga.
 */
export function scollegaCampiModificati(
  arricchitoDa: string | null,
  prima: ContattoDaArricchire,
  dopo: ContattoDaArricchire,
): string | null {
  const ereditati = new Set(
    (arricchitoDa ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );
  if (ereditati.size === 0) return null;

  const restano = CAMPI_ARRICCHIBILI.filter(
    (c) => ereditati.has(c) && prima[c] === dopo[c],
  );
  return restano.length > 0 ? restano.join(',') : null;
}
