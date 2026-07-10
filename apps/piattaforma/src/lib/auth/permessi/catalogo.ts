/**
 * Catalogo dei permessi granulari per gli utenti azienda (dealer/agenzia).
 * Unica fonte di verità: chiavi, etichette, dipendenze e appartenenza al
 * companyType. Spec: docs/superpowers/specs/2026-07-10-permessi-granulari-design.md
 *
 * I poteri owner-only (creare sedi, firmare il mandato, anagrafica azienda,
 * rendiconto madre) NON stanno qui: non sono delegabili.
 */

export type CompanyTypeP = 'DEALER' | 'AGENZIA';

/**
 * Le 30 chiavi valide. `Permesso` deriva da qui, non dal CATALOGO: le voci senza
 * `soloPer` non hanno la proprietà sotto `as const`, e ogni accesso diventerebbe
 * un `'soloPer' in p`. Il test «PERMESSI e CATALOGO non divergono» tiene allineate
 * le due liste.
 */
export const PERMESSI = [
  'pratiche.view',
  'pratiche.download',
  'pratiche.create',
  'pratiche.annulla',
  'pratiche.valuta',
  'pratiche.processa',
  'pratiche.firma',
  'pratiche.segnala',
  'inbox.view',
  'inbox.gestisci',
  'wallet.view',
  'wallet.payout',
  'wallet.soglia',
  'fatture.view',
  'fatture.download',
  'fatture.xml',
  'addebiti.view',
  'pagamenti.ritenta',
  'pagamenti.iban',
  'affiliazione.view',
  'feedback.view',
  'sede.view',
  'sede.edit',
  'orari.view',
  'orari.edit',
  'team.view',
  'team.invita',
  'team.crea',
  'team.modifica',
  'team.reset_password',
  'team.disabilita',
  'team.permessi',
  'notifiche.view',
] as const;

/** Un refuso in un gate — `requirePermesso('wallet.payuot')` — non compila. */
export type Permesso = (typeof PERMESSI)[number];

export type PermessoDef = {
  chiave: Permesso;
  etichetta: string;
  /** Mostrata accanto alla casella: spiega la conseguenza di un'azione sensibile. */
  nota?: string;
  sensibile?: boolean;
  /** Permesso padre: concederlo implica concedere il padre. Tipizzato: niente refusi. */
  richiede?: Permesso;
  /** Se assente, il permesso vale per entrambi i companyType. */
  soloPer?: CompanyTypeP;
};

export type CategoriaDef = {
  id: string;
  etichetta: string;
  soloPer?: CompanyTypeP;
  permessi: PermessoDef[];
};

export const CATALOGO: CategoriaDef[] = [
  {
    id: 'pratiche',
    etichetta: 'Pratiche',
    permessi: [
      { chiave: 'pratiche.view', etichetta: 'Vede le pratiche della sua sede' },
      { chiave: 'pratiche.download', etichetta: 'Scarica documenti in PDF e ZIP', richiede: 'pratiche.view' },
      { chiave: 'pratiche.create', etichetta: 'Crea e invia pratiche', richiede: 'pratiche.view', soloPer: 'DEALER' },
      { chiave: 'pratiche.annulla', etichetta: 'Annulla una pratica', richiede: 'pratiche.view', soloPer: 'DEALER' },
      { chiave: 'pratiche.valuta', etichetta: "Valuta l'agenzia", richiede: 'pratiche.view', soloPer: 'DEALER' },
      { chiave: 'pratiche.processa', etichetta: 'Segna una pratica processata', richiede: 'pratiche.view', soloPer: 'AGENZIA' },
      {
        chiave: 'pratiche.firma',
        etichetta: 'Segna una pratica firmata',
        nota: 'accredita il wallet e genera la fattura',
        sensibile: true,
        richiede: 'pratiche.view',
        soloPer: 'AGENZIA',
      },
      {
        chiave: 'pratiche.segnala',
        etichetta: 'Segnala un problema sulla pratica',
        nota: 'apre una penale di €25 al broker',
        sensibile: true,
        richiede: 'pratiche.view',
        soloPer: 'AGENZIA',
      },
    ],
  },
  {
    id: 'inbox',
    etichetta: 'Inbox',
    soloPer: 'AGENZIA',
    permessi: [
      { chiave: 'inbox.view', etichetta: 'Vede le pratiche in arrivo' },
      { chiave: 'inbox.gestisci', etichetta: 'Accetta o rifiuta le assegnazioni', richiede: 'inbox.view' },
    ],
  },
  {
    id: 'wallet',
    etichetta: 'Wallet',
    permessi: [
      { chiave: 'wallet.view', etichetta: 'Vede saldo e movimenti' },
      {
        chiave: 'wallet.payout',
        etichetta: 'Richiede il payout',
        nota: 'preleva denaro reale dal wallet',
        sensibile: true,
        richiede: 'wallet.view',
      },
      { chiave: 'wallet.soglia', etichetta: 'Modifica la soglia di auto-payout', richiede: 'wallet.view' },
    ],
  },
  {
    id: 'fatture',
    etichetta: 'Fatture',
    permessi: [
      { chiave: 'fatture.view', etichetta: 'Vede la sezione fatture' },
      { chiave: 'fatture.download', etichetta: 'Scarica PDF e ZIP', richiede: 'fatture.view' },
      { chiave: 'fatture.xml', etichetta: 'Scarica XML FatturaPA', nota: 'per il commercialista', richiede: 'fatture.view' },
    ],
  },
  {
    id: 'pagamenti',
    etichetta: 'Addebiti e pagamenti',
    soloPer: 'AGENZIA',
    permessi: [
      { chiave: 'addebiti.view', etichetta: 'Vede lo storico degli addebiti' },
      { chiave: 'pagamenti.ritenta', etichetta: 'Ritenta un addebito fallito' },
      {
        chiave: 'pagamenti.iban',
        etichetta: "Cambia l'IBAN e ricrea il mandato SEPA",
        nota: 'cambia il conto addebitato',
        sensibile: true,
        richiede: 'pagamenti.ritenta',
      },
    ],
  },
  {
    id: 'crescita',
    etichetta: 'Crescita',
    permessi: [
      { chiave: 'affiliazione.view', etichetta: 'Vede link e statistiche di affiliazione' },
      { chiave: 'feedback.view', etichetta: 'Vede le valutazioni ricevute', soloPer: 'AGENZIA' },
    ],
  },
  {
    id: 'sede',
    etichetta: 'Sede',
    permessi: [
      { chiave: 'sede.view', etichetta: 'Vede le impostazioni della sede' },
      { chiave: 'sede.edit', etichetta: 'Modifica anagrafica e soglia payout', richiede: 'sede.view' },
      { chiave: 'orari.view', etichetta: 'Vede gli orari di apertura', soloPer: 'AGENZIA' },
      { chiave: 'orari.edit', etichetta: 'Modifica gli orari di apertura', richiede: 'orari.view', soloPer: 'AGENZIA' },
    ],
  },
  {
    id: 'team',
    etichetta: 'Team',
    permessi: [
      { chiave: 'team.view', etichetta: 'Vede la sezione team' },
      { chiave: 'team.invita', etichetta: 'Invia inviti via email', richiede: 'team.view' },
      { chiave: 'team.crea', etichetta: 'Crea utenti con password impostata', richiede: 'team.view' },
      { chiave: 'team.modifica', etichetta: 'Modifica i dati di un utente', richiede: 'team.view' },
      { chiave: 'team.reset_password', etichetta: 'Genera una password temporanea', richiede: 'team.view' },
      { chiave: 'team.disabilita', etichetta: 'Disabilita utenti e revoca inviti', richiede: 'team.view' },
      {
        chiave: 'team.permessi',
        etichetta: 'Assegna permessi ad altri utenti',
        nota: 'permette di delegare i propri poteri',
        sensibile: true,
        richiede: 'team.view',
      },
    ],
  },
  {
    id: 'notifiche',
    etichetta: 'Notifiche',
    permessi: [{ chiave: 'notifiche.view', etichetta: "Vede lo storico notifiche dell'azienda" }],
  },
];

const TUTTE_LE_DEF: PermessoDef[] = CATALOGO.flatMap((c) =>
  c.permessi.map((p) => ({ ...p, soloPer: p.soloPer ?? c.soloPer })),
);

const BY_CHIAVE = new Map<string, PermessoDef>(TUTTE_LE_DEF.map((p) => [p.chiave, p]));

/** Narrowing al confine: righe del DB e campi dei form arrivano come `string`. */
export function isPermesso(x: string): x is Permesso {
  return BY_CHIAVE.has(x);
}

export function dipendenzaDi(p: Permesso): Permesso | undefined {
  return BY_CHIAVE.get(p)?.richiede;
}

function vale(def: { soloPer?: CompanyTypeP }, t: CompanyTypeP): boolean {
  return def.soloPer === undefined || def.soloPer === t;
}

export function catalogoPerTipo(t: CompanyTypeP): CategoriaDef[] {
  return CATALOGO.filter((c) => vale(c, t))
    .map((c) => ({ ...c, permessi: c.permessi.filter((p) => vale({ soloPer: p.soloPer ?? c.soloPer }, t)) }))
    .filter((c) => c.permessi.length > 0);
}

export function permessiPerTipo(t: CompanyTypeP): Permesso[] {
  return catalogoPerTipo(t).flatMap((c) => c.permessi.map((p) => p.chiave));
}

/** Chiude il set risalendo la catena dei padri: `sede.edit` → `sede.view`. */
export function conDipendenze(permessi: Permesso[]): Permesso[] {
  const out = new Set<Permesso>();
  for (const p of permessi) {
    let cur: Permesso | undefined = p;
    while (cur && !out.has(cur)) {
      out.add(cur);
      cur = dipendenzaDi(cur);
    }
  }
  return [...out];
}

/** Figli diretti di un permesso: usati dalla UI per spegnere a cascata. */
export function figliDi(p: Permesso): Permesso[] {
  return TUTTE_LE_DEF.filter((d) => d.richiede === p).map((d) => d.chiave);
}
