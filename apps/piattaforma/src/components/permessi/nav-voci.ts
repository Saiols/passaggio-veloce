import type { Permesso } from '@/lib/auth/permessi/catalogo';
import { filtraGruppi } from './nav-filter';

/** Chiave dell'icona: la shell la risolve nel componente React. Il modulo resta puro. */
export type VoceNav = { href: string; label: string; icona: string; permesso?: Permesso };
export type GruppoNav = { label: string; items: VoceNav[] };

export type NavInput = {
  isOwner: boolean;
  permessi: readonly Permesso[];
  /** `getManageableSedi().length > 0`. Senza sedi gestibili, i permessi team sono inerti. */
  puoGestireTeam: boolean;
  /**
   * Account sospeso. Obbligatorio come su `NavCtx`, e per la stessa ragione: le
   * voci di nav oggi sono tutte gated su chiavi di lettura, ma la prima gated su
   * una chiave di scrittura non deve poter comparire a un titolare sospeso solo
   * perché qualcuno ha dimenticato di propagare il flag.
   */
  soloLettura: boolean;
};

/**
 * Voce Team: serve `team.view` **e** una sede gestibile. `manageableSedi()`
 * filtra sul ruolo di sede, quindi per un OPERATORE è vuoto: mostrargli la
 * voce comunque significherebbe rimbalzarlo alla dashboard al primo click.
 *
 * Prima di questo modulo la condizione era duplicata (identica) in
 * broker-shell.tsx e agenzia-shell.tsx e nessun test la copriva: un reviewer
 * l'ha rimossa e la suite component è rimasta verde. Qui è un unico punto,
 * coperto da nav-voci.test.ts.
 */
function voceTeam(puoGestireTeam: boolean): VoceNav[] {
  return puoGestireTeam
    ? [{ href: '/team', label: 'Team', icona: 'utenti', permesso: 'team.view' as const }]
    : [];
}

/**
 * Sedi: owner-only e non delegabile, quindi non è un permesso del catalogo
 * (niente `permesso` sotto). Impostazioni sede: sola lettura per i non-owner,
 * gated sul permesso `sede.view`.
 */
function vociSede(isOwner: boolean): VoceNav[] {
  return isOwner
    ? [{ href: '/sedi', label: 'Sedi', icona: 'agenzie' }]
    : [
        {
          href: '/impostazioni-sede',
          label: 'Impostazioni sede',
          icona: 'agenzie',
          permesso: 'sede.view' as const,
        },
      ];
}

/**
 * Visura camerale: owner-only e non delegabile come Sedi (l'aggiornamento è
 * gated su `isOwner` in `app/visura/actions.ts`, non su una chiave del
 * catalogo) → niente `permesso` qui. La mancanza è deliberata anche per un
 * secondo motivo: la visura è il RIMEDIO a un blocco — `mappa-sospensione.ts`
 * marca le sue action `CONSENTI` anche per un account sospeso — e una voce
 * gated su un permesso sparirebbe proprio a chi ha più bisogno di trovarla.
 *
 * Serve una voce fissa perché `VisuraBanner`, l'unico altro ingresso in-app,
 * si auto-annulla su OK ed ESENTE: senza questa, rinnovare in anticipo o
 * caricare la prima visura richiedeva di conoscere l'URL a memoria.
 */
function voceVisura(isOwner: boolean): VoceNav[] {
  return isOwner ? [{ href: '/visura', label: 'Visura camerale', icona: 'visura' }] : [];
}

export function gruppiBroker(input: NavInput): GruppoNav[] {
  const { isOwner, permessi, puoGestireTeam, soloLettura } = input;
  const gruppi: { label: string; items: VoceNav[] }[] = [
    {
      label: 'Panoramica',
      items: [{ href: '/dashboard', label: 'Dashboard', icona: 'dashboard' }],
    },
    {
      label: 'Operatività',
      items: [
        { href: '/pratiche', label: 'Pratiche', icona: 'pratiche', permesso: 'pratiche.view' as const },
      ],
    },
    {
      label: 'Finanze',
      items: [
        { href: '/wallet', label: 'Wallet', icona: 'wallet', permesso: 'wallet.view' as const },
        { href: '/fatturazione', label: 'Fatture', icona: 'fattura', permesso: 'fatture.view' as const },
      ],
    },
    {
      label: 'Crescita',
      items: [
        {
          href: '/affiliazione',
          label: 'Affiliazione',
          icona: 'affiliazioni',
          permesso: 'affiliazione.view' as const,
        },
      ],
    },
    {
      label: 'Impostazioni',
      items: [
        { href: '/notifiche', label: 'Notifiche', icona: 'notifiche', permesso: 'notifiche.view' as const },
        { href: '/profilo', label: 'Profilo', icona: 'profilo' },
        ...voceVisura(isOwner),
        ...vociSede(isOwner),
        ...voceTeam(puoGestireTeam),
      ],
    },
  ];
  return filtraGruppi<VoceNav>(gruppi, { isOwner, permessi, soloLettura });
}

export function gruppiAgenzia(input: NavInput): GruppoNav[] {
  const { isOwner, permessi, puoGestireTeam, soloLettura } = input;
  const gruppi: { label: string; items: VoceNav[] }[] = [
    {
      label: 'Panoramica',
      items: [{ href: '/dashboard', label: 'Dashboard', icona: 'dashboard' }],
    },
    {
      label: 'Operatività',
      items: [
        { href: '/inbox', label: 'Inbox', icona: 'inbox', permesso: 'inbox.view' as const },
        {
          href: '/pratiche',
          label: 'Pratiche attive',
          icona: 'pratiche',
          permesso: 'pratiche.view' as const,
        },
      ],
    },
    {
      label: 'Finanze',
      items: [
        { href: '/wallet', label: 'Wallet', icona: 'wallet', permesso: 'wallet.view' as const },
        { href: '/fatturazione', label: 'Fatture', icona: 'fattura', permesso: 'fatture.view' as const },
        { href: '/addebiti', label: 'Addebiti', icona: 'addebiti', permesso: 'addebiti.view' as const },
      ],
    },
    {
      label: 'Crescita',
      items: [
        {
          href: '/affiliazione',
          label: 'Affiliazione',
          icona: 'affiliazioni',
          permesso: 'affiliazione.view' as const,
        },
        { href: '/feedback', label: 'Feedback', icona: 'feedback', permesso: 'feedback.view' as const },
      ],
    },
    {
      label: 'Impostazioni',
      items: [
        { href: '/orari', label: 'Orari', icona: 'orari', permesso: 'orari.view' as const },
        { href: '/notifiche', label: 'Notifiche', icona: 'notifiche', permesso: 'notifiche.view' as const },
        { href: '/profilo', label: 'Profilo', icona: 'profilo' },
        ...voceVisura(isOwner),
        ...vociSede(isOwner),
        ...voceTeam(puoGestireTeam),
      ],
    },
  ];
  return filtraGruppi<VoceNav>(gruppi, { isOwner, permessi, soloLettura });
}
