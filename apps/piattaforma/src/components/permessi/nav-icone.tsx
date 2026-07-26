import type { ComponentType } from 'react';
import {
  IconAddebiti,
  IconAffiliazioni,
  IconAgenzie,
  IconDashboard,
  IconFattura,
  IconFeedback,
  IconInbox,
  IconNotifiche,
  IconOrari,
  IconPratiche,
  IconProfilo,
  IconRevisioni,
  IconUtenti,
  IconWallet,
  type AdminIconProps,
} from '@/components/admin/admin-icons';

/**
 * Le voci in `nav-voci.ts` (modulo puro, niente JSX) portano una chiave
 * stringa (`icona`); qui la sidebar la risolve nel componente React. Stesse
 * icone di prima del refactor — nessun cambiamento visivo.
 */
const ICONE: Record<string, ComponentType<AdminIconProps>> = {
  dashboard: IconDashboard,
  pratiche: IconPratiche,
  wallet: IconWallet,
  fattura: IconFattura,
  affiliazioni: IconAffiliazioni,
  notifiche: IconNotifiche,
  profilo: IconProfilo,
  agenzie: IconAgenzie,
  utenti: IconUtenti,
  inbox: IconInbox,
  addebiti: IconAddebiti,
  feedback: IconFeedback,
  orari: IconOrari,
  // Documento con spunta: la visura è un documento certificato, non un'anagrafica.
  visura: IconRevisioni,
};

/**
 * Una chiave non mappata è un bug di programmazione (icona nuova aggiunta a
 * nav-voci.ts senza registrarla qui): fallisce esplicitamente invece di un
 * `?? IconDefault` silenzioso che nasconderebbe l'errore rendendo una voce
 * senza icona.
 */
export function iconaComponente(icona: string): ComponentType<AdminIconProps> {
  const Icon = ICONE[icona];
  if (!Icon) throw new Error(`nav-icone: chiave icona non mappata: "${icona}"`);
  return Icon;
}
