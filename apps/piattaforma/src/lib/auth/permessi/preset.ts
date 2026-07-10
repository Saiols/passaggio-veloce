import { conDipendenze, permessiPerTipo, type CompanyTypeP, type Permesso } from './catalogo';

export type PresetId = 'OPERATORE_BASE' | 'OPERATORE_COMPLETO' | 'ADMIN_SEDE';

export const PRESET_ETICHETTE: Record<PresetId, string> = {
  OPERATORE_BASE: 'Operatore base',
  OPERATORE_COMPLETO: 'Operatore completo',
  ADMIN_SEDE: 'Admin di sede',
};

export const PRESET_IDS: PresetId[] = ['OPERATORE_BASE', 'OPERATORE_COMPLETO', 'ADMIN_SEDE'];

const BASE: Record<CompanyTypeP, Permesso[]> = {
  DEALER: ['pratiche.view', 'pratiche.create', 'pratiche.download', 'notifiche.view'],
  AGENZIA: [
    'pratiche.view',
    'pratiche.processa',
    'pratiche.download',
    'inbox.view',
    'inbox.gestisci',
    'notifiche.view',
  ],
};

const COMPLETO: Record<CompanyTypeP, Permesso[]> = {
  DEALER: [
    ...BASE.DEALER,
    'pratiche.annulla',
    'pratiche.valuta',
    'fatture.view',
    'fatture.download',
    'wallet.view',
    'affiliazione.view',
  ],
  AGENZIA: [
    ...BASE.AGENZIA,
    'pratiche.firma',
    'pratiche.segnala',
    'fatture.view',
    'fatture.download',
    'wallet.view',
    'addebiti.view',
    'affiliazione.view',
    'feedback.view',
    'orari.view',
  ],
};

/** Set di partenza in creazione utenza. Chiuso rispetto alle dipendenze. */
export function preset(id: PresetId, t: CompanyTypeP): Permesso[] {
  if (id === 'ADMIN_SEDE') return permessiPerTipo(t);
  const base = id === 'OPERATORE_BASE' ? BASE[t] : COMPLETO[t];
  return conDipendenze(base);
}

/** Il preset che coincide esattamente col set dato, altrimenti null (= personalizzato). */
export function riconoscePreset(permessi: Permesso[], t: CompanyTypeP): PresetId | null {
  const dato = [...new Set(permessi)].sort().join('|');
  if (!dato) return null;
  for (const id of PRESET_IDS) {
    if (preset(id, t).sort().join('|') === dato) return id;
  }
  return null;
}
