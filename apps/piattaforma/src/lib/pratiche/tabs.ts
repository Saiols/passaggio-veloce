import type { ConteggiTab } from './stati';

/**
 * Tab della lista pratiche. NON introducono un parametro nuovo: scrivono sullo
 * stesso `?stato=` della select "Stato", usando i valori aggregati IN_CORSO e
 * CONCLUSE (stesso meccanismo di IN_ATTESA, già in uso). Un solo parametro ⇒
 * tab e select non possono entrare in conflitto e gli URL restano condivisibili.
 */
export type ValoreTab = '' | 'IN_CORSO' | 'BOZZA' | 'CONCLUSE';

export type TabPratiche = { value: ValoreTab; label: string; count: number };

/** Filtri che i tab devono trascinarsi dietro. `page` è volutamente fuori. */
export type FiltriTab = { q?: string; periodo?: string; sede?: string };

export function tabsPratiche({
  isAgenzia,
  conteggi,
}: {
  isAgenzia: boolean;
  conteggi: ConteggiTab;
}): TabPratiche[] {
  const tabs: TabPratiche[] = [
    { value: '', label: 'Tutte', count: conteggi.tutte },
    { value: 'IN_CORSO', label: 'In corso', count: conteggi.inCorso },
  ];
  // L'agenzia non ha bozze: `agenziaSedeId` viene scritto solo all'accettazione
  // (inbox/actions.ts:92), quindi le pratiche non ancora assegnate non compaiono
  // nella sua lista e il tab sarebbe perennemente a zero.
  if (!isAgenzia) tabs.push({ value: 'BOZZA', label: 'Bozze', count: conteggi.bozze });
  tabs.push({ value: 'CONCLUSE', label: 'Concluse', count: conteggi.concluse });
  return tabs;
}

/**
 * Quale tab risulta selezionato dato `?stato=`. Un filtro più fine di qualunque
 * tab (es. `PROCESSATA` scelto dalla select) non ne accende nessuno: mostrare
 * "In corso" attivo mentre vedi solo le processate sarebbe fuorviante.
 */
export function tabAttivo(stato: string | undefined): ValoreTab | null {
  if (!stato) return '';
  if (stato === 'IN_CORSO' || stato === 'BOZZA' || stato === 'CONCLUSE') return stato;
  return null;
}

export function hrefTab(value: ValoreTab, filtri: FiltriTab): string {
  const qs = new URLSearchParams();
  if (value) qs.set('stato', value);
  if (filtri.q) qs.set('q', filtri.q);
  if (filtri.periodo) qs.set('periodo', filtri.periodo);
  if (filtri.sede) qs.set('sede', filtri.sede);
  const s = qs.toString();
  return s ? `/pratiche?${s}` : '/pratiche';
}
