# Arricchimento contatto CRM dall'iscrizione — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** quando un'iscrizione si aggancia a un contatto CRM, i campi anagrafici vuoti del contatto vengono riempiti con i dati dell'identità registrata — sia sui nuovi agganci sia, ogni notte, su quelli già esistenti.

**Architecture:** un modulo puro (`lib/crm/match/arricchimento.ts`) calcola la patch da scrivere; un modulo server (`arricchimento-scrittura.ts`) la applica con compare-and-set. Due chiamanti: `apply.ts` subito dopo un aggancio riuscito e `syncCrmFromPlatform` per i contatti già agganciati. Nessuna query in più nel caso normale: `apply.ts` estende una `findUnique` che già faceva e `sync.ts` salta ogni lettura se il contatto non ha buchi.

**Tech Stack:** Next.js 16 App Router, Prisma 5.22 + Postgres 17, vitest, Tailwind con token `pv-*`, pnpm monorepo Turborepo.

Spec di riferimento: `docs/superpowers/specs/2026-07-28-crm-arricchimento-contatto-design.md`.

## Global Constraints

- **Solo i campi vuoti.** Non si sovrascrive mai un valore già presente sul contatto, nemmeno se il dato registrato è diverso. Vuoto = `null`, `''` o soli spazi.
- **Le colonne `*Norm` passano sempre da `crmNormFields`** (`lib/crm/match/norm-fields.ts`). Mai calcolate a mano, mai scritte per un campo che non si sta scrivendo.
- **`tel`, `telNorm` e `nome` non si toccano mai.**
- **La PEC non finisce mai in `email`.**
- **Migration a mano + `db:deploy`.** `pnpm db:migrate` (`prisma migrate dev`) è distruttivo su questo schema: propone DROP SEQUENCE. Non usarlo.
- **Le migration vanno applicate su Neon PRIMA del push.** Il codice legge `arricchitoDa`: senza colonna, in prod la pagina CRM contatti va giù.
- **Niente colori hardcoded** nei componenti: solo token `pv-*` esistenti (`globals.css`). Non esistono `pv-blue-*`: il blu chiaro disponibile è `pv-navy-100`.
- **Comandi:** test `pnpm --filter piattaforma test`, typecheck `pnpm typecheck` (a cache calda; da zero tsc va in stack overflow — non è un errore reale).

---

### Task 1: Mappa provincia → regione

Sigla di provincia (`Company.provincia`, `Sede.provincia`) → nome regione nella forma canonica già usata dai filtri CRM. Modulo puro, nessuna dipendenza dal CRM: sta in `lib/geo/` perché è geografia italiana, non logica di match.

**Files:**
- Create: `apps/piattaforma/src/lib/geo/province.ts`
- Test: `apps/piattaforma/src/lib/geo/province.test.ts`

**Interfaces:**
- Consumes: `REGIONI_ITALIANE` da `@/lib/crm/regione` (le 20 forme canoniche, già esistente).
- Produces: `regioneDaProvincia(sigla: string | null | undefined): string | null` — ritorna una delle stringhe di `REGIONI_ITALIANE`, oppure `null` se la sigla non è riconosciuta.

- [ ] **Step 1: Scrivi il test che fallisce**

```ts
// apps/piattaforma/src/lib/geo/province.test.ts
import { describe, it, expect } from 'vitest';
import { REGIONI_ITALIANE } from '@/lib/crm/regione';
import { regioneDaProvincia, PROVINCE_ITALIANE } from './province';

describe('regioneDaProvincia', () => {
  it('mappa le sigle note', () => {
    expect(regioneDaProvincia('MI')).toBe('Lombardia');
    expect(regioneDaProvincia('RM')).toBe('Lazio');
    expect(regioneDaProvincia('AO')).toBe("Valle d'Aosta");
    expect(regioneDaProvincia('SU')).toBe('Sardegna'); // Sud Sardegna, riforma 2016
  });

  it('tollera minuscolo e spazi', () => {
    expect(regioneDaProvincia(' mi ')).toBe('Lombardia');
  });

  it('sigla ignota o vuota → null (mai un valore inventato)', () => {
    expect(regioneDaProvincia('XX')).toBeNull();
    expect(regioneDaProvincia('')).toBeNull();
    expect(regioneDaProvincia(null)).toBeNull();
    // Province abolite nel 2016: non mappate di proposito, meglio nessun
    // valore che uno sbagliato.
    expect(regioneDaProvincia('OT')).toBeNull();
  });

  it('sono 107 sigle e ognuna punta a una regione canonica', () => {
    const sigle = Object.keys(PROVINCE_ITALIANE);
    expect(sigle).toHaveLength(107);
    for (const s of sigle) {
      expect(REGIONI_ITALIANE).toContain(PROVINCE_ITALIANE[s]);
    }
  });

  it('copre tutte e 20 le regioni', () => {
    const coperte = new Set(Object.values(PROVINCE_ITALIANE));
    expect([...coperte].sort()).toEqual([...REGIONI_ITALIANE].sort());
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `pnpm --filter piattaforma test src/lib/geo/province.test.ts`
Expected: FAIL — `Failed to resolve import "./province"`.

- [ ] **Step 3: Scrivi la mappa**

```ts
// apps/piattaforma/src/lib/geo/province.ts
/**
 * Sigla di provincia → regione, nelle forme canoniche di `lib/crm/regione.ts`.
 *
 * Serve all'arricchimento del contatto CRM: `Company` e `Sede` hanno la
 * provincia, `CrmContact` ha la regione (è il campo su cui filtra il CRM e su
 * cui si colora la mappa). Senza questa tabella il campo resterebbe vuoto per
 * ogni contatto agganciato.
 *
 * Le 107 province in vigore. Le quattro abolite dalla riforma sarda del 2016
 * (OT, OG, VS, CI) NON sono qui: non possono comparire in una registrazione
 * nuova, e un dato mancante è preferibile a uno indovinato.
 */
import { REGIONI_ITALIANE } from '@/lib/crm/regione';

type Regione = (typeof REGIONI_ITALIANE)[number];

export const PROVINCE_ITALIANE: Record<string, Regione> = {
  // Abruzzo
  AQ: 'Abruzzo', CH: 'Abruzzo', PE: 'Abruzzo', TE: 'Abruzzo',
  // Basilicata
  MT: 'Basilicata', PZ: 'Basilicata',
  // Calabria
  CS: 'Calabria', CZ: 'Calabria', KR: 'Calabria', RC: 'Calabria', VV: 'Calabria',
  // Campania
  AV: 'Campania', BN: 'Campania', CE: 'Campania', NA: 'Campania', SA: 'Campania',
  // Emilia-Romagna
  BO: 'Emilia-Romagna', FC: 'Emilia-Romagna', FE: 'Emilia-Romagna',
  MO: 'Emilia-Romagna', PC: 'Emilia-Romagna', PR: 'Emilia-Romagna',
  RA: 'Emilia-Romagna', RE: 'Emilia-Romagna', RN: 'Emilia-Romagna',
  // Friuli-Venezia Giulia
  GO: 'Friuli-Venezia Giulia', PN: 'Friuli-Venezia Giulia',
  TS: 'Friuli-Venezia Giulia', UD: 'Friuli-Venezia Giulia',
  // Lazio
  FR: 'Lazio', LT: 'Lazio', RI: 'Lazio', RM: 'Lazio', VT: 'Lazio',
  // Liguria
  GE: 'Liguria', IM: 'Liguria', SP: 'Liguria', SV: 'Liguria',
  // Lombardia
  BG: 'Lombardia', BS: 'Lombardia', CO: 'Lombardia', CR: 'Lombardia',
  LC: 'Lombardia', LO: 'Lombardia', MB: 'Lombardia', MI: 'Lombardia',
  MN: 'Lombardia', PV: 'Lombardia', SO: 'Lombardia', VA: 'Lombardia',
  // Marche
  AN: 'Marche', AP: 'Marche', FM: 'Marche', MC: 'Marche', PU: 'Marche',
  // Molise
  CB: 'Molise', IS: 'Molise',
  // Piemonte
  AL: 'Piemonte', AT: 'Piemonte', BI: 'Piemonte', CN: 'Piemonte',
  NO: 'Piemonte', TO: 'Piemonte', VB: 'Piemonte', VC: 'Piemonte',
  // Puglia
  BA: 'Puglia', BR: 'Puglia', BT: 'Puglia', FG: 'Puglia', LE: 'Puglia', TA: 'Puglia',
  // Sardegna
  CA: 'Sardegna', NU: 'Sardegna', OR: 'Sardegna', SS: 'Sardegna', SU: 'Sardegna',
  // Sicilia
  AG: 'Sicilia', CL: 'Sicilia', CT: 'Sicilia', EN: 'Sicilia', ME: 'Sicilia',
  PA: 'Sicilia', RG: 'Sicilia', SR: 'Sicilia', TP: 'Sicilia',
  // Toscana
  AR: 'Toscana', FI: 'Toscana', GR: 'Toscana', LI: 'Toscana', LU: 'Toscana',
  MS: 'Toscana', PI: 'Toscana', PO: 'Toscana', PT: 'Toscana', SI: 'Toscana',
  // Trentino-Alto Adige
  BZ: 'Trentino-Alto Adige', TN: 'Trentino-Alto Adige',
  // Umbria
  PG: 'Umbria', TR: 'Umbria',
  // Valle d'Aosta
  AO: "Valle d'Aosta",
  // Veneto
  BL: 'Veneto', PD: 'Veneto', RO: 'Veneto', TV: 'Veneto',
  VE: 'Veneto', VI: 'Veneto', VR: 'Veneto',
};

export function regioneDaProvincia(
  sigla: string | null | undefined,
): string | null {
  if (!sigla) return null;
  return PROVINCE_ITALIANE[sigla.trim().toUpperCase()] ?? null;
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `pnpm --filter piattaforma test src/lib/geo/province.test.ts`
Expected: PASS, 5 test.

Se il conteggio non torna 107, non "aggiustare" il numero atteso: cerca la sigla mancante o duplicata. Un duplicato in un object literal è silenzioso — l'ultima vince.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/geo/province.ts apps/piattaforma/src/lib/geo/province.test.ts
git commit -m "feat(geo): la sigla di provincia sa in che regione sta"
```

---

### Task 2: Modulo puro dell'arricchimento

Il cuore: date le anagrafiche del contatto e dell'identità registrata, decide cosa scrivere. Nessun DB, nessun `server-only`.

**Files:**
- Create: `apps/piattaforma/src/lib/crm/match/arricchimento.ts`
- Test: `apps/piattaforma/src/lib/crm/match/arricchimento.test.ts`

**Interfaces:**
- Consumes: `normalizeTel` da `./normalize`, `crmNormFields` da `./norm-fields`, `regioneDaProvincia` da `@/lib/geo/province` (Task 1).
- Produces:
  - `CAMPI_ARRICCHIBILI: readonly CampoArricchibile[]` — ordine canonico `['email','wa','piva','indirizzo','citta','cap','regione']`.
  - `type CampoArricchibile = 'email'|'wa'|'piva'|'indirizzo'|'citta'|'cap'|'regione'`
  - `type ContattoDaArricchire = Record<CampoArricchibile, string | null>`
  - `type AnagraficaSorgente` / `type SorgenteArricchimento`
  - `type PatchArricchimento = { dati: Partial<Record<CampoArricchibile, string>>; campi: CampoArricchibile[] }`
  - `SELECT_ARRICCHIMENTO` — lo `select` Prisma dei campi che servono a calcolare e a fare il CAS (fonte unica per Task 5 e Task 6).
  - `campiVuoti(contatto: ContattoDaArricchire): CampoArricchibile[]`
  - `calcolaArricchimento(contatto, sorgente): PatchArricchimento | null`
  - `normDaPatch(patch): Partial<CrmNormFields>`
  - `unisciArricchitoDa(precedente: string | null, nuovi: CampoArricchibile[]): string`

- [ ] **Step 1: Scrivi i test che falliscono**

```ts
// apps/piattaforma/src/lib/crm/match/arricchimento.test.ts
import { describe, it, expect } from 'vitest';
import {
  calcolaArricchimento,
  campiVuoti,
  normDaPatch,
  unisciArricchitoDa,
  type ContattoDaArricchire,
  type SorgenteArricchimento,
} from './arricchimento';

const VUOTO: ContattoDaArricchire = {
  email: null, wa: null, piva: null,
  indirizzo: null, citta: null, cap: null, regione: null,
};

const SORGENTE: SorgenteArricchimento = {
  company: {
    email: 'info@agenziacorsico.it',
    telefono: '02 4478712',
    partitaIva: '01234567890',
    indirizzo: 'Via Fiume',
    civico: '6',
    citta: 'Corsico',
    cap: '20094',
    provincia: 'MI',
  },
  sede: null,
};

describe('calcolaArricchimento', () => {
  it('contatto vuoto → riempie tutto quello che può', () => {
    const patch = calcolaArricchimento(VUOTO, SORGENTE)!;
    expect(patch.dati).toEqual({
      email: 'info@agenziacorsico.it',
      piva: '01234567890',
      indirizzo: 'Via Fiume 6',
      citta: 'Corsico',
      cap: '20094',
      regione: 'Lombardia',
    });
    // `wa` assente: 02 4478712 è un fisso, non un numero WhatsApp.
    expect(patch.campi).toEqual(['email', 'piva', 'indirizzo', 'citta', 'cap', 'regione']);
  });

  it('campo già valorizzato → non si tocca', () => {
    const patch = calcolaArricchimento(
      { ...VUOTO, email: 'commerciale@agenziacorsico.it', citta: 'CORSICO' },
      SORGENTE,
    )!;
    expect(patch.dati.email).toBeUndefined();
    expect(patch.dati.citta).toBeUndefined();
  });

  it('campo di soli spazi conta come vuoto', () => {
    const patch = calcolaArricchimento({ ...VUOTO, email: '   ' }, SORGENTE)!;
    expect(patch.dati.email).toBe('info@agenziacorsico.it');
  });

  it('match su sede: vincono i dati della sede', () => {
    const patch = calcolaArricchimento(VUOTO, {
      ...SORGENTE,
      sede: {
        email: 'buccinasco@agenziacorsico.it',
        telefono: null,
        indirizzo: 'Viale Lombardia',
        civico: '12',
        citta: 'Buccinasco',
        cap: '20090',
        provincia: 'MI',
      },
    })!;
    expect(patch.dati.email).toBe('buccinasco@agenziacorsico.it');
    expect(patch.dati.indirizzo).toBe('Viale Lombardia 12');
    expect(patch.dati.citta).toBe('Buccinasco');
    expect(patch.dati.cap).toBe('20090');
    // la P.IVA è solo della madre: la sede non ne ha una
    expect(patch.dati.piva).toBe('01234567890');
  });

  it('sede senza email → scende alla madre', () => {
    const patch = calcolaArricchimento(VUOTO, {
      ...SORGENTE,
      sede: {
        email: null, telefono: null,
        indirizzo: 'Viale Lombardia', civico: '12',
        citta: 'Buccinasco', cap: '20090', provincia: 'MI',
      },
    })!;
    expect(patch.dati.email).toBe('info@agenziacorsico.it');
  });

  it('la PEC non finisce mai in email', () => {
    // La PEC non è nemmeno nel tipo sorgente: il test lo fissa passandola
    // come campo in più e verificando che non venga usata.
    const conPec = {
      ...SORGENTE,
      company: { ...SORGENTE.company, email: '', pec: 'agenziacorsico@pec.it' },
    } as unknown as SorgenteArricchimento;
    const patch = calcolaArricchimento(VUOTO, conPec)!;
    expect(patch.dati.email).toBeUndefined();
  });

  it('wa riempito solo con un cellulare', () => {
    const mobile = calcolaArricchimento(VUOTO, {
      ...SORGENTE,
      company: { ...SORGENTE.company, telefono: '+39 333 1234567' },
    })!;
    expect(mobile.dati.wa).toBe('+39 333 1234567');

    const fisso = calcolaArricchimento(VUOTO, SORGENTE)!;
    expect(fisso.dati.wa).toBeUndefined();
  });

  it('wa: se la sede ha il fisso e la madre il cellulare, prende il cellulare', () => {
    const patch = calcolaArricchimento(VUOTO, {
      company: { ...SORGENTE.company, telefono: '333 1234567' },
      sede: {
        email: null, telefono: '02 4478712',
        indirizzo: 'Viale Lombardia', civico: null,
        citta: 'Buccinasco', cap: '20090', provincia: 'MI',
      },
    })!;
    expect(patch.dati.wa).toBe('333 1234567');
  });

  it('indirizzo senza civico non porta spazi in coda', () => {
    const patch = calcolaArricchimento(VUOTO, {
      ...SORGENTE,
      company: { ...SORGENTE.company, civico: null },
    })!;
    expect(patch.dati.indirizzo).toBe('Via Fiume');
  });

  it('provincia ignota → regione non scritta', () => {
    const patch = calcolaArricchimento(VUOTO, {
      ...SORGENTE,
      company: { ...SORGENTE.company, provincia: 'XX' },
    })!;
    expect(patch.dati.regione).toBeUndefined();
    expect(patch.campi).not.toContain('regione');
  });

  it('valore sorgente vuoto → campo non scritto', () => {
    const patch = calcolaArricchimento(VUOTO, {
      ...SORGENTE,
      company: { ...SORGENTE.company, email: '' },
    })!;
    expect(patch.dati.email).toBeUndefined();
  });

  it('contatto completo → null, così il chiamante non scrive nulla', () => {
    expect(
      calcolaArricchimento(
        {
          email: 'a@b.it', wa: '3331234567', piva: '01234567890',
          indirizzo: 'Via Fiume 6', citta: 'Corsico', cap: '20094',
          regione: 'Lombardia',
        },
        SORGENTE,
      ),
    ).toBeNull();
  });
});

describe('campiVuoti', () => {
  it('elenca i buchi in ordine canonico', () => {
    expect(campiVuoti({ ...VUOTO, email: 'a@b.it', citta: '  ' })).toEqual([
      'wa', 'piva', 'indirizzo', 'citta', 'cap', 'regione',
    ]);
  });

  it('contatto pieno → nessun buco', () => {
    expect(
      campiVuoti({
        email: 'a@b.it', wa: '3331234567', piva: '01234567890',
        indirizzo: 'Via Fiume 6', citta: 'Corsico', cap: '20094',
        regione: 'Lombardia',
      }),
    ).toEqual([]);
  });
});

describe('normDaPatch', () => {
  it('normalizza solo i campi scritti — mai telNorm', () => {
    const norm = normDaPatch({
      dati: { email: ' INFO@Agenzia.IT ', citta: 'Corsico' },
      campi: ['email', 'citta'],
    });
    expect(norm).toEqual({ emailNorm: 'info@agenzia.it' });
    expect(norm).not.toHaveProperty('telNorm');
    expect(norm).not.toHaveProperty('pivaNorm');
  });

  it('un valore non normalizzabile dà null, non stringa vuota', () => {
    const norm = normDaPatch({ dati: { piva: 'N/D' }, campi: ['piva'] });
    expect(norm).toEqual({ pivaNorm: null });
  });
});

describe('unisciArricchitoDa', () => {
  it('primo arricchimento', () => {
    expect(unisciArricchitoDa(null, ['email', 'citta'])).toBe('email,citta');
  });

  it('unisce al precedente senza duplicati e in ordine canonico', () => {
    expect(unisciArricchitoDa('citta,email', ['wa', 'email'])).toBe('email,wa,citta');
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `pnpm --filter piattaforma test src/lib/crm/match/arricchimento.test.ts`
Expected: FAIL — `Failed to resolve import "./arricchimento"`.

- [ ] **Step 3: Scrivi il modulo**

```ts
// apps/piattaforma/src/lib/crm/match/arricchimento.ts
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
    email: primo(s?.email, c.email),
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
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `pnpm --filter piattaforma test src/lib/crm/match/arricchimento.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/crm/match/arricchimento.ts apps/piattaforma/src/lib/crm/match/arricchimento.test.ts
git commit -m "feat(crm): la regola di cosa il contatto può ereditare dall'iscrizione"
```

---

### Task 3: Colonne di audit (schema + migration)

Due colonne su `crm_contacts`. Migration scritta a mano e applicata con `db:deploy`: `prisma migrate dev` su questo schema propone DROP SEQUENCE.

**Files:**
- Create: `packages/db/prisma/migrations/20260728120000_crm_contacts_arricchimento/migration.sql`
- Modify: `packages/db/prisma/schema.prisma` (modello `CrmContact`, blocco "Match con Company piattaforma")

- [ ] **Step 1: Scrivi la migration**

```sql
-- packages/db/prisma/migrations/20260728120000_crm_contacts_arricchimento/migration.sql
-- Arricchimento del contatto CRM dai dati dell'iscrizione.
--
-- Quando il motore di match aggancia una riga della lista all'azienda
-- registrata, i campi anagrafici vuoti del contatto vengono riempiti con i
-- dati della registrazione. Queste due colonne dicono QUALI campi non sono
-- stati raccolti al telefono ma ereditati dalla piattaforma: senza, il
-- venditore non ha modo di sapere che l'email che sta per usare non gliel'ha
-- mai dettata nessuno.
--
-- `arricchitoDa` è un CSV di nomi di campo in ordine canonico
-- (es. 'email,citta,regione') e si ACCUMULA fra una passata e l'altra.
-- Nessun indice: non ci si filtra sopra, si legge solo aprendo il contatto.
ALTER TABLE "crm_contacts" ADD COLUMN "arricchitoDa" TEXT;
ALTER TABLE "crm_contacts" ADD COLUMN "arricchitoAt" TIMESTAMP(3);
```

- [ ] **Step 2: Allinea lo schema Prisma**

In `packages/db/prisma/schema.prisma`, nel modello `CrmContact`, subito dopo `matchedAt DateTime?`:

```prisma
  // Campi riempiti dall'iscrizione perché il contatto li aveva vuoti
  // (lib/crm/match/arricchimento.ts). CSV in ordine canonico, si accumula.
  arricchitoDa String?
  arricchitoAt DateTime?
```

- [ ] **Step 3: Applica in locale e rigenera il client**

Run:
```bash
pnpm --filter @pv/db db:deploy
pnpm --filter @pv/db exec prisma generate
```
Expected: `1 migration applied`, poi `Generated Prisma Client`.

⚠️ Non usare `pnpm db:migrate`.

- [ ] **Step 4: Verifica che le colonne esistano davvero**

Run:
```bash
docker compose exec -T postgres psql -U postgres -d passaggio_veloce -c "\d crm_contacts" | grep arricchito
```
Expected: due righe, `arricchitoDa | text` e `arricchitoAt | timestamp(3) without time zone`.

Se il comando non parte affatto (container fermo), l'assenza di output non è una conferma: avvia il container e ripeti.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/migrations packages/db/prisma/schema.prisma
git commit -m "feat(db): il contatto CRM ricorda quali dati ha ereditato"
```

---

### Task 4: Scrittura con compare-and-set

**Files:**
- Create: `apps/piattaforma/src/lib/crm/match/arricchimento-scrittura.ts`
- Test: `apps/piattaforma/src/lib/crm/match/arricchimento-scrittura.test.ts`

**Interfaces:**
- Consumes: `normDaPatch`, `unisciArricchitoDa`, `PatchArricchimento`, `ContattoDaArricchire` da `./arricchimento` (Task 2); colonne di Task 3.
- Produces: `applicaArricchimento(contactId: string, patch: PatchArricchimento, letto: ContattoDaArricchire & { arricchitoDa: string | null }): Promise<boolean>` — `true` se ha scritto.

- [ ] **Step 1: Scrivi i test che falliscono**

```ts
// apps/piattaforma/src/lib/crm/match/arricchimento-scrittura.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const contactUpdateMany = vi.fn();
vi.mock('@pv/db', () => ({
  prisma: { crmContact: { updateMany: (...a: unknown[]) => contactUpdateMany(...a) } },
}));

import { applicaArricchimento } from './arricchimento-scrittura';
import type { ContattoDaArricchire } from './arricchimento';

const LETTO: ContattoDaArricchire & { arricchitoDa: string | null } = {
  email: null, wa: null, piva: null,
  indirizzo: null, citta: '  ', cap: '20094', regione: null,
  arricchitoDa: null,
};

const PATCH = {
  dati: { email: 'info@agenzia.it', citta: 'Corsico' },
  campi: ['email', 'citta'] as const,
};

describe('applicaArricchimento', () => {
  beforeEach(() => {
    contactUpdateMany.mockReset();
    contactUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('scrive i campi, le norm e l\'audit', async () => {
    expect(await applicaArricchimento('x1', { ...PATCH, campi: [...PATCH.campi] }, LETTO)).toBe(true);
    const { data } = contactUpdateMany.mock.calls[0]![0];
    expect(data.email).toBe('info@agenzia.it');
    expect(data.citta).toBe('Corsico');
    expect(data.emailNorm).toBe('info@agenzia.it');
    expect(data.arricchitoDa).toBe('email,citta');
    expect(data.arricchitoAt).toBeInstanceOf(Date);
    // telNorm non è nei dati: il telefono non si tocca mai
    expect(data).not.toHaveProperty('telNorm');
  });

  it('compare-and-set sul valore letto, non su null', async () => {
    await applicaArricchimento('x1', { ...PATCH, campi: [...PATCH.campi] }, LETTO);
    const { where } = contactUpdateMany.mock.calls[0]![0];
    // `citta` era '  ' (soli spazi): il where deve confrontare ESATTAMENTE
    // quel valore, altrimenti la riga non viene trovata e il campo resta
    // vuoto per sempre senza che nulla lo segnali.
    expect(where).toEqual({ id: 'x1', deletedAt: null, email: null, citta: '  ' });
  });

  it('qualcuno ha compilato il campo nel frattempo → non scrive, torna false', async () => {
    contactUpdateMany.mockResolvedValue({ count: 0 });
    expect(await applicaArricchimento('x1', { ...PATCH, campi: [...PATCH.campi] }, LETTO)).toBe(false);
  });

  it('l\'audit precedente non si perde', async () => {
    await applicaArricchimento(
      'x1',
      { dati: { wa: '3331234567' }, campi: ['wa'] },
      { ...LETTO, arricchitoDa: 'email' },
    );
    expect(contactUpdateMany.mock.calls[0]![0].data.arricchitoDa).toBe('email,wa');
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `pnpm --filter piattaforma test src/lib/crm/match/arricchimento-scrittura.test.ts`
Expected: FAIL — modulo non risolto.

- [ ] **Step 3: Scrivi il modulo**

```ts
// apps/piattaforma/src/lib/crm/match/arricchimento-scrittura.ts
import 'server-only';
import { prisma, type Prisma } from '@pv/db';
import {
  normDaPatch,
  unisciArricchitoDa,
  type ContattoDaArricchire,
  type PatchArricchimento,
} from './arricchimento';

/**
 * Applica la patch calcolata da `calcolaArricchimento`.
 *
 * Compare-and-set sui campi stessi: si scrive solo se ognuno ha ancora il
 * valore che aveva alla lettura. Fra il calcolo e la scrittura passano altri
 * round-trip, ed è la stessa finestra in cui un admin può compilare l'email a
 * mano dal pannello contatti; senza guardia il cron notturno gliela
 * sovrascriverebbe con quella della registrazione, in silenzio.
 *
 * Il confronto è sul valore letto e NON su `null`/`''`: un campo di soli
 * spazi conta come vuoto per `calcolaArricchimento`, e una guardia scritta
 * come `OR: [{ campo: null }, { campo: '' }]` non lo troverebbe — `count`
 * tornerebbe 0 per sempre senza che nulla lo segnali.
 *
 * `deletedAt: null` per lo stesso motivo di `apply.ts`: non si scrive su una
 * riga cancellata contandola come arricchita.
 */
export async function applicaArricchimento(
  contactId: string,
  patch: PatchArricchimento,
  letto: ContattoDaArricchire & { arricchitoDa: string | null },
): Promise<boolean> {
  const where: Prisma.CrmContactWhereInput = {
    id: contactId,
    deletedAt: null,
    ...Object.fromEntries(patch.campi.map((c) => [c, letto[c]])),
  };

  const res = await prisma.crmContact.updateMany({
    where,
    data: {
      ...patch.dati,
      ...normDaPatch(patch),
      arricchitoDa: unisciArricchitoDa(letto.arricchitoDa, patch.campi),
      arricchitoAt: new Date(),
    },
  });
  return res.count > 0;
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `pnpm --filter piattaforma test src/lib/crm/match/arricchimento-scrittura.test.ts`
Expected: PASS, 4 test.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/crm/match/arricchimento-scrittura.ts apps/piattaforma/src/lib/crm/match/arricchimento-scrittura.test.ts
git commit -m "feat(crm): scrivere l'arricchimento senza scavalcare chi l'ha compilato a mano"
```

---

### Task 5: Aggancio ai nuovi match (engine + apply + esito admin)

Il percorso dei nuovi agganci: registrazione, cron e pagina admin passano tutti da `applicaProposte`.

**Files:**
- Modify: `apps/piattaforma/src/lib/crm/match/identita.ts` (tipi `CompanyGrezza`/`SedeGrezza`: aggiungere `provincia`)
- Modify: `apps/piattaforma/src/lib/crm/match/engine.ts` (`SELECT_COMPANY`, tipo `Proposta`, costruzione della proposta)
- Modify: `apps/piattaforma/src/lib/crm/match/apply.ts` (`findUnique` esteso, arricchimento dopo l'aggancio, `EsitoApply.arricchiti`)
- Modify: `apps/piattaforma/src/app/admin/crm/riconciliazione/actions.ts` (`arricchiti` nel risultato)
- Modify: `apps/piattaforma/src/app/admin/crm/riconciliazione/client.tsx:47-53` (messaggio d'esito)
- Test: `apps/piattaforma/src/lib/crm/match/apply.test.ts` (esistente, da estendere), `apps/piattaforma/src/lib/crm/match/engine.test.ts` (esistente, da estendere)

**Interfaces:**
- Consumes: `calcolaArricchimento`, `SELECT_ARRICCHIMENTO`, `SorgenteArricchimento` (Task 2); `applicaArricchimento` (Task 4).
- Produces:
  - `Proposta.sorgente: SorgenteArricchimento` — usato solo da `apply.ts`.
  - `EsitoApply.arricchiti: number` — risale in `EsitoRiconciliazione` e nell'action admin.

- [ ] **Step 1: Scrivi i test che falliscono**

In `apply.test.ts`, aggiungi `sorgente` alla costante `PROPOSTA` esistente (subito dopo `ambigua: false`):

```ts
  sorgente: {
    company: {
      email: 'info@agenziacorsico.it',
      telefono: '02 4478712',
      partitaIva: '01234567890',
      indirizzo: 'Via Fiume',
      civico: '6',
      citta: 'Corsico',
      cap: '20094',
      provincia: 'MI',
    },
    sede: null,
  },
```

e aggiungi in fondo al `describe('applicaProposte')`:

```ts
  it('dopo l\'aggancio riempie i campi vuoti del contatto', async () => {
    contactFindUnique.mockResolvedValue({
      status: 'S0',
      email: null, wa: null, piva: null,
      indirizzo: null, citta: null, cap: null, regione: null,
      arricchitoDa: null,
    });
    const esito = await applicaProposte([PROPOSTA]);
    expect(esito.arricchiti).toBe(1);
    // prima updateMany = aggancio, seconda = arricchimento
    const arricchimento = contactUpdateMany.mock.calls[1]![0];
    expect(arricchimento.data.email).toBe('info@agenziacorsico.it');
    expect(arricchimento.data.regione).toBe('Lombardia');
    expect(arricchimento.data.arricchitoDa).toBe('email,piva,indirizzo,citta,cap,regione');
  });

  it('contatto già completo → nessuna seconda scrittura', async () => {
    contactFindUnique.mockResolvedValue({
      status: 'S0',
      email: 'a@b.it', wa: '3331234567', piva: '01234567890',
      indirizzo: 'Via Fiume 6', citta: 'Corsico', cap: '20094',
      regione: 'Lombardia', arricchitoDa: null,
    });
    const esito = await applicaProposte([PROPOSTA]);
    expect(esito.agganciati).toBe(1);
    expect(esito.arricchiti).toBe(0);
    expect(contactUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('un arricchimento fallito non declassa un aggancio riuscito', async () => {
    contactFindUnique.mockResolvedValue({
      status: 'S0', email: null, wa: null, piva: null,
      indirizzo: null, citta: null, cap: null, regione: null, arricchitoDa: null,
    });
    contactUpdateMany
      .mockResolvedValueOnce({ count: 1 })            // aggancio: ok
      .mockRejectedValueOnce(new Error('db giù'));    // arricchimento: esplode
    const esito = await applicaProposte([PROPOSTA]);
    expect(esito).toEqual({ agganciati: 1, saltati: 0, errori: 0, arricchiti: 0 });
  });
```

I test già esistenti che asseriscono `expect(esito).toEqual({ agganciati: 1, saltati: 0, errori: 0 })` vanno aggiornati aggiungendo `arricchiti: 0` (o il valore atteso). Il `beforeEach` esistente va cambiato così, perché ora la `findUnique` deve restituire anche l'anagrafica:

```ts
    contactFindUnique.mockResolvedValue({
      status: 'S0',
      email: 'a@b.it', wa: '3331234567', piva: '01234567890',
      indirizzo: 'Via Fiume 6', citta: 'Corsico', cap: '20094',
      regione: 'Lombardia', arricchitoDa: null,
    });
```

In `engine.test.ts` aggiungi `provincia: 'MI',` alle fixture `COMPANY` (dopo `cap: '20094',`) e `SEDE` (dopo `cap: '20100',`), poi aggiungi i due test:

```ts
  it("la proposta porta l'anagrafica dell'identità agganciata", async () => {
    mockDb({ companies: [COMPANY_CON_SEDE], contatti: [CONTATTO_SEDE] });
    const proposte = await calcolaProposte();
    expect(proposte).toHaveLength(1);
    const { sorgente } = proposte[0]!;
    expect(sorgente.company.partitaIva).toBe('06199680155');
    expect(sorgente.company.provincia).toBe('MI');
    // Match sulla sede: viaggia la SEDE, non solo la madre. Senza,
    // l'arricchimento scriverebbe l'indirizzo della madre su una riga che
    // è un altro punto vendita.
    expect(sorgente.sede?.citta).toBe('Milano');
    expect(sorgente.sede?.provincia).toBe('MI');
  });

  it('match sulla madre → sorgente.sede è null', async () => {
    mockDb({ companies: [COMPANY], contatti: [CONTATTO] });
    const proposte = await calcolaProposte();
    expect(proposte[0]!.sorgente.sede).toBeNull();
  });
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `pnpm --filter piattaforma test src/lib/crm/match/`
Expected: FAIL — `esito.arricchiti` è `undefined`, `sorgente` non esiste sulla proposta.

- [ ] **Step 3: Aggiungi `provincia` ai tipi grezzi**

In `identita.ts`, dentro `SedeGrezza` e `CompanyGrezza`, subito dopo `cap: string;`:

```ts
  provincia: string;
```

- [ ] **Step 4: Porta la sorgente nella proposta**

In `engine.ts`:

```ts
import type { SorgenteArricchimento } from './arricchimento';
```

In `SELECT_COMPANY`, aggiungi `provincia: true,` dopo `cap: true,` — in **entrambi** i punti, il livello company e il `select` dentro `sedi`.

Nel tipo `Proposta`, dopo `registrataAt`:

```ts
  /**
   * Anagrafica dell'identità agganciata, per l'arricchimento del contatto
   * (lib/crm/match/arricchimento.ts). Viaggia con la proposta perché qui
   * company e sedi sono già in memoria: farla rileggere ad `apply.ts`
   * significherebbe una query in più per ogni aggancio.
   */
  sorgente: SorgenteArricchimento;
```

Prima del `return coppie.map(...)`, aggiungi le due mappe accanto a quelle dei nomi:

```ts
  const perCompany = new Map(companies.map((c) => [c.id, c]));
  const perSede = new Map(
    companies.flatMap((c) => c.sedi.map((s) => [s.id, s] as const)),
  );
```

e dentro il `map`, dopo `registrataAt: co.identita.registrataAt,`:

```ts
    sorgente: {
      company: perCompany.get(co.identita.companyId)!,
      sede: co.identita.sedeId ? (perSede.get(co.identita.sedeId) ?? null) : null,
    },
```

`CompanyGrezza` e `SedeGrezza` hanno campi in più rispetto ad `AnagraficaSorgente`: sono variabili, non literal, quindi TypeScript le accetta senza excess property check.

- [ ] **Step 5: Arricchisci dopo l'aggancio in `apply.ts`**

Import:

```ts
import { calcolaArricchimento, SELECT_ARRICCHIMENTO } from './arricchimento';
import { applicaArricchimento } from './arricchimento-scrittura';
```

`EsitoApply` guadagna un campo:

```ts
  /** Contatti su cui l'aggancio ha anche riempito almeno un campo vuoto. */
  arricchiti: number;
```

Nella funzione, `let arricchiti = 0;` accanto agli altri contatori, e la `findUnique` diventa:

```ts
      const attuale = await prisma.crmContact.findUnique({
        where: { id: p.contactId },
        // L'anagrafica arriva nella STESSA lettura che serviva per lo stato:
        // l'arricchimento non aggiunge nessun round-trip.
        select: { status: true, ...SELECT_ARRICCHIMENTO },
      });
```

Il ramo finale:

```ts
      if (res.count > 0) {
        agganciati++;
        // Best-effort e in un try/catch PROPRIO: l'aggancio è già scritto,
        // un errore qui non deve trasformarlo in un errore né in un salto.
        try {
          const patch = calcolaArricchimento(attuale, p.sorgente);
          if (patch && (await applicaArricchimento(p.contactId, patch, attuale))) {
            arricchiti++;
          }
        } catch (err) {
          console.error(
            `[applicaProposte] arricchimento fallito su ${p.contactId}:`,
            err,
          );
        }
      } else saltati++;
```

e il `return { agganciati, saltati, errori, arricchiti };`.

- [ ] **Step 6: Fai risalire il numero alla pagina admin**

In `riconciliazione/actions.ts`, il tipo `EsitoRiconciliazione` guadagna `arricchiti: number` nel ramo `ok: true`, e il return `arricchiti: esito.arricchiti,`.

In `riconciliazione/client.tsx`, il messaggio (righe 47-53) diventa:

```tsx
      setEsito(
        res.ok
          ? `${res.agganciati} righe agganciate, ${res.saltati} saltate` +
              ` (già agganciate o cambiate nel frattempo)` +
              `${res.arricchiti > 0 ? `, ${res.arricchiti} completate coi dati dell'iscrizione` : ''}` +
              `${res.errori > 0 ? `, ${res.errori} errori` : ''}.`
          : res.error,
      );
```

- [ ] **Step 7: Esegui i test e verifica che passino**

Run: `pnpm --filter piattaforma test src/lib/crm/`
Expected: PASS. Se `sync-match.test.ts` o `riconciliazione/actions.test.ts` diventano rossi è perché i loro mock di `applicaProposte`/`riconciliaTutto` non hanno `arricchiti`: aggiungilo ai valori mockati.

- [ ] **Step 8: Commit**

```bash
git add apps/piattaforma/src/lib/crm/match apps/piattaforma/src/app/admin/crm/riconciliazione
git commit -m "feat(crm): chi si aggancia adesso porta i suoi dati nel contatto"
```

---

### Task 6: I contatti già agganciati (cron)

Nessun backfill separato: la prima esecuzione del cron riempie il pregresso, e le successive raccolgono quello che nel frattempo l'azienda ha aggiunto.

**Files:**
- Modify: `apps/piattaforma/src/lib/crm/sync.ts` (`syncCrmFromPlatform`)
- Test: `apps/piattaforma/src/lib/crm/sync-aggregati.test.ts` (esistente, da estendere)

**Interfaces:**
- Consumes: `campiVuoti`, `calcolaArricchimento`, `SELECT_ARRICCHIMENTO` (Task 2); `applicaArricchimento` (Task 4).
- Produces: `syncCrmFromPlatform(): Promise<{ scanned: number; updated: number; arricchiti: number }>` — il campo in più finisce da solo nel JSON di `api/jobs/crm-sync`, che già fa `...result`.

- [ ] **Step 1: Scrivi i test che falliscono**

Il file mocka oggi `crmContact.findMany`/`update`, `company.findUnique`, `pratica.count`, `user.findFirst`. Servono due mock in più — nel blocco `vi.mock('@pv/db')` aggiungi `updateMany: (...a: unknown[]) => contactUpdateMany(...a),` dentro `crmContact` e `sede: { findUnique: (...a: unknown[]) => sedeFindUnique(...a) },` accanto a `company`, con i rispettivi `const ... = vi.fn()` e i `mockReset()` nel `beforeEach`.

Nel `beforeEach`, il contatto di default va completato (senza, ogni test esistente entrerebbe nel ramo dell'arricchimento e il file non direbbe più cosa sta verificando):

```ts
    contactFindMany.mockResolvedValue([
      {
        id: 'k1', companyId: 'c1', sedeId: null,
        email: 'a@b.it', wa: '3331234567', piva: '01234567890',
        indirizzo: 'Via Fiume 6', citta: 'Corsico', cap: '20094',
        regione: 'Lombardia', arricchitoDa: null,
      },
    ]);
    contactUpdateMany.mockResolvedValue({ count: 1 });
```

I test esistenti mockano `companyFindUnique` con solo `type`/`suspendedAt`/`deletedAt`: vanno lasciati così: con il contatto completo l'arricchimento non parte e l'anagrafica assente non serve.

Poi aggiungi:

```ts
  it('riempie i buchi di un contatto già agganciato', async () => {
    contactFindMany.mockResolvedValue([
      {
        id: 'x1', companyId: 'c1', sedeId: null,
        email: null, wa: null, piva: null,
        indirizzo: null, citta: null, cap: null, regione: null,
        arricchitoDa: null,
      },
    ]);
    companyFindUnique.mockResolvedValue({
      type: 'AGENZIA', suspendedAt: null, deletedAt: null,
      email: 'info@agenziacorsico.it', telefono: '02 4478712',
      partitaIva: '01234567890', indirizzo: 'Via Fiume', civico: '6',
      citta: 'Corsico', cap: '20094', provincia: 'MI',
    });
    const res = await syncCrmFromPlatform();
    expect(res.arricchiti).toBe(1);
    expect(contactUpdateMany).toHaveBeenCalledTimes(1);
    expect(contactUpdateMany.mock.calls[0]![0].data.citta).toBe('Corsico');
  });

  it('contatto senza buchi → nessuna lettura della sede, nessuna scrittura', async () => {
    contactFindMany.mockResolvedValue([
      {
        id: 'x1', companyId: 'c1', sedeId: 'sede-1',
        email: 'a@b.it', wa: '3331234567', piva: '01234567890',
        indirizzo: 'Via Fiume 6', citta: 'Corsico', cap: '20094',
        regione: 'Lombardia', arricchitoDa: 'email',
      },
    ]);
    const res = await syncCrmFromPlatform();
    expect(res.arricchiti).toBe(0);
    expect(sedeFindUnique).not.toHaveBeenCalled();
    expect(contactUpdateMany).not.toHaveBeenCalled();
  });

  it('un arricchimento che esplode non ferma il giro degli aggregati', async () => {
    contactFindMany.mockResolvedValue([
      {
        id: 'x1', companyId: 'c1', sedeId: null,
        email: null, wa: null, piva: null,
        indirizzo: null, citta: null, cap: null, regione: null,
        arricchitoDa: null,
      },
    ]);
    contactUpdateMany.mockRejectedValue(new Error('db giù'));
    const res = await syncCrmFromPlatform();
    expect(res.updated).toBe(1);
    expect(res.arricchiti).toBe(0);
  });
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `pnpm --filter piattaforma test src/lib/crm/sync-aggregati.test.ts`
Expected: FAIL — `res.arricchiti` è `undefined`.

- [ ] **Step 3: Estendi il giro del cron**

In `sync.ts`, import:

```ts
import { campiVuoti, calcolaArricchimento, SELECT_ARRICCHIMENTO } from './match/arricchimento';
import { applicaArricchimento } from './match/arricchimento-scrittura';
```

La `findMany` iniziale porta anche l'anagrafica, così i buchi si calcolano senza query:

```ts
  const contacts = await prisma.crmContact.findMany({
    where: { deletedAt: null, companyId: { not: null } },
    select: { id: true, companyId: true, sedeId: true, ...SELECT_ARRICCHIMENTO },
  });

  let updated = 0;
  let arricchiti = 0;
```

La `findUnique` della company guadagna i campi anagrafici (era `select: { type: true, suspendedAt: true, deletedAt: true }`):

```ts
    const company = await prisma.company.findUnique({
      where: { id: c.companyId },
      select: {
        type: true, suspendedAt: true, deletedAt: true,
        // Anagrafica per l'arricchimento: la lettura c'era già, il select
        // costa zero query in più.
        email: true, telefono: true, partitaIva: true,
        indirizzo: true, civico: true, citta: true, cap: true, provincia: true,
      },
    });
```

Dopo `updated++;`, in fondo al ciclo:

```ts
    // Arricchimento dei contatti già agganciati: riempie i campi che la lista
    // non aveva. Il pre-controllo sui buchi evita di leggere la sede per i
    // contatti già completi, che dopo la prima passata sono la norma.
    try {
      if (campiVuoti(c).length > 0) {
        const sede = c.sedeId
          ? await prisma.sede.findUnique({
              where: { id: c.sedeId },
              select: {
                email: true, telefono: true, indirizzo: true,
                civico: true, citta: true, cap: true, provincia: true,
              },
            })
          : null;
        const patch = calcolaArricchimento(c, { company, sede });
        if (patch && (await applicaArricchimento(c.id, patch, c))) arricchiti++;
      }
    } catch (err) {
      // Best-effort: gli aggregati di questo contatto sono già scritti e
      // quelli dei contatti successivi non devono saltare per questo.
      console.error(`[syncCrmFromPlatform] arricchimento fallito su ${c.id}:`, err);
    }
```

e il return diventa `return { scanned: contacts.length, updated, arricchiti };`.

Aggiorna anche il tipo di ritorno dichiarato nella firma:

```ts
export async function syncCrmFromPlatform(): Promise<{
  scanned: number;
  updated: number;
  arricchiti: number;
}> {
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `pnpm --filter piattaforma test src/lib/crm/ src/app/api/jobs/`
Expected: PASS. Se `api/jobs/crm-sync/route.test.ts` asserisce sul corpo JSON, aggiungi `arricchiti` ai valori mockati di `syncCrmFromPlatform`.

- [ ] **Step 5: Commit**

```bash
git add apps/piattaforma/src/lib/crm/sync.ts apps/piattaforma/src/lib/crm/sync-aggregati.test.ts
git commit -m "feat(crm): ogni notte i contatti già agganciati recuperano i dati che mancano"
```

---

### Task 7: Il venditore vede da dove viene il dato

**Files:**
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/page.tsx:146-165` (serializzazione `arricchitoAt`)
- Modify: `apps/piattaforma/src/app/admin/crm/contatti/client.tsx` (tipo `Contatto`, prop e riga di `TabAnagrafica`)

**Interfaces:**
- Consumes: `type CampoArricchibile` da `@/lib/crm/match/arricchimento` (import **solo di tipo**: il modulo è puro ma non serve nel bundle client).
- Produces: nessuna API nuova.

- [ ] **Step 1: Serializza la data**

In `page.tsx`, nel `.map((c) => ({ ... }))`, accanto agli altri `toISOString()`:

```ts
    arricchitoAt: c.arricchitoAt?.toISOString() ?? null,
```

`arricchitoDa` passa già da `...c`: la query usa `include`, quindi tutti gli scalari ci sono.

- [ ] **Step 2: Estendi il tipo lato client**

In `client.tsx`, nel type `Contatto`, dopo `sedeNome: string | null;`:

```ts
  arricchitoDa: string | null;
  arricchitoAt: string | null;
```

- [ ] **Step 3: Passa il dato al tab**

In `client.tsx`, la chiamata a `TabAnagrafica` (riga ~1008) diventa:

```tsx
            <TabAnagrafica
              data={data}
              set={set}
              salesUsers={salesUsers}
              readOnly={isReadOnlyForSales}
              field={field}
              arricchimento={
                contact
                  ? { da: contact.arricchitoDa, at: contact.arricchitoAt }
                  : null
              }
            />
```

Si passa `contact` e non `data`: `data` è la bozza modificabile del form, l'audit no.

- [ ] **Step 4: Mostra la riga**

Sopra `function TabAnagrafica`:

```tsx
import type { CampoArricchibile } from '@/lib/crm/match/arricchimento';

/**
 * Etichette dei campi arricchiti, uguali a quelle del form. Il Record è
 * tipato su `CampoArricchibile`: se domani il motore impara ad arricchire un
 * campo nuovo, TypeScript chiede l'etichetta qui invece di mostrare all'admin
 * il nome grezzo della colonna.
 */
const LABEL_CAMPO: Record<CampoArricchibile, string> = {
  email: 'Email',
  wa: 'WhatsApp',
  piva: 'P.IVA',
  indirizzo: 'Indirizzo',
  citta: 'Città',
  cap: 'CAP',
  regione: 'Regione',
};

function RigaArricchimento({ da, at }: { da: string; at: string | null }) {
  const campi = da
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => LABEL_CAMPO[c as CampoArricchibile] ?? c);
  return (
    <div className="sm:col-span-2 rounded-[10px] bg-pv-navy-100 px-3 py-2 text-[12px] text-pv-navy-800">
      <span className="font-bold">Dati completati dall&apos;iscrizione</span>
      {' — '}
      {campi.join(', ')}
      {at && ` · ${new Date(at).toLocaleDateString('it-IT')}`}
    </div>
  );
}
```

La firma di `TabAnagrafica` guadagna la prop:

```tsx
}: TabProps & {
  salesUsers: SalesUser[];
  field: (key: string) => FieldState;
  arricchimento: { da: string | null; at: string | null } | null;
}) {
```

e il primo figlio del `<div className="grid ...">` diventa:

```tsx
      {arricchimento?.da && (
        <RigaArricchimento da={arricchimento.da} at={arricchimento.at} />
      )}
```

- [ ] **Step 5: Verifica typecheck e test**

Run: `pnpm typecheck && pnpm --filter piattaforma test`
Expected: entrambi verdi.

Se `tsc` parte a cache fredda e va in stack overflow o segnala errori Prisma inventati, non è un errore vero: rilancia con la cache calda.

- [ ] **Step 6: Commit**

```bash
git add apps/piattaforma/src/app/admin/crm/contatti
git commit -m "feat(crm): il contatto dice quali dati non gli ha dettati nessuno"
```

---

### Task 8: Verifica end-to-end e allineamento della roadmap

I test provano la regola, non che sui dati veri succeda qualcosa. Questo task chiude il cerchio prima del rilascio.

**Files:**
- Modify: `docs/piano-implementazione.md` (voce di progresso)

- [ ] **Step 1: Conta i buchi sul DB locale (copia di prod), in sola lettura**

```bash
docker compose exec -T postgres psql -U postgres -d passaggio_veloce -c "
SELECT count(*) FILTER (WHERE \"companyId\" IS NOT NULL) AS agganciati,
       count(*) FILTER (WHERE \"companyId\" IS NOT NULL AND (email IS NULL OR btrim(email) = '')) AS senza_email,
       count(*) FILTER (WHERE \"companyId\" IS NOT NULL AND (regione IS NULL OR btrim(regione) = '')) AS senza_regione
FROM crm_contacts WHERE \"deletedAt\" IS NULL;"
```

Annota i numeri: sono il "prima". Se `agganciati` è 0 il locale non ha il pregresso e i passi 2-3 non dimostrano niente — dillo invece di dichiarare la verifica fatta.

- [ ] **Step 2: Lancia il cron in locale**

Con il dev server attivo (`pnpm dev`), da loggato come ADMIN_PIATTAFORMA apri `http://localhost:3000/api/jobs/crm-sync` e leggi il JSON: deve contenere `arricchiti`.

- [ ] **Step 3: Ricconta e confronta**

Rilancia la query dello Step 1. `senza_email` e `senza_regione` devono essere scesi. Poi guarda una riga davvero arricchita:

```bash
docker compose exec -T postgres psql -U postgres -d passaggio_veloce -c "
SELECT nome, email, citta, regione, \"arricchitoDa\", \"arricchitoAt\"
FROM crm_contacts WHERE \"arricchitoDa\" IS NOT NULL LIMIT 5;"
```

Controlla che `arricchitoDa` elenchi esattamente i campi che risultano valorizzati e che nessuna email sia una PEC.

- [ ] **Step 4: Guarda la pagina nel browser**

Apri `/admin/crm/contatti`, clicca su un contatto con `arricchitoDa` valorizzato (non navigare per URL: la riga è un click), e verifica sul DOM che la riga "Dati completati dall'iscrizione" ci sia, con le etichette giuste e la data in formato italiano. Apri anche un contatto non arricchito: la riga non deve comparire.

- [ ] **Step 5: Aggiorna la roadmap**

In `docs/piano-implementazione.md`, aggiungi la voce nella sezione del CRM, accanto a quella della riconciliazione.

- [ ] **Step 6: Commit**

```bash
git add docs/piano-implementazione.md
git commit -m "docs: arricchimento contatto CRM in piano implementazione"
```

- [ ] **Step 7: Rilascio**

⚠️ Nell'ordine, senza scorciatoie:

1. applica la migration su Neon **ep-solitary-night** (`DATABASE_URL` di Vercel): `pnpm --filter @pv/db db:deploy` puntato a prod;
2. verifica le colonne su prod (`\d crm_contacts`);
3. solo dopo, `git push` su `main`.

Invertire i due passi porta giù `/admin/crm/contatti` in prod fino al deploy successivo.

---

## Note per chi implementa

- **Ordine dei task.** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Il 3 (migration) deve stare prima del 4, o il client Prisma non conosce `arricchitoDa` e il typecheck del Task 4 fallisce.
- **`sorgente` nei mock.** Ogni test che costruisce una `Proposta` a mano va aggiornato: `apply.test.ts`, `sync-match.test.ts`, `engine.test.ts`. Un `sorgente` mancante è un errore di tipo, non un test rosso a runtime.
- **Non spostare la logica in `apply.ts`.** La stessa regola gira in due percorsi con letture diverse; se la duplichi, il cron e la registrazione diventano due comportamenti che divergono al primo cambio.
