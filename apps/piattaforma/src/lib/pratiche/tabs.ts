import type { ConteggiTab } from './stati';

/**
 * Tab della lista pratiche. NON introducono un parametro nuovo: scrivono sullo
 * stesso `?stato=` della select "Stato", usando i valori aggregati IN_CORSO e
 * CONCLUSE (stesso meccanismo di IN_ATTESA, già in uso). Un solo parametro ⇒
 * tab e select non possono entrare in conflitto e gli URL restano condivisibili.
 */
export type ValoreTab = '' | 'IN_CORSO' | 'IN_ESCALATION' | 'BOZZA' | 'CONCLUSE';

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
 * Tab della lista admin. Come quelli di broker/agenzia, più "In escalation":
 * è l'unica coda su cui l'admin deve davvero agire, e per il broker non esiste.
 *
 * `escalation` è un SOTTOINSIEME di `inCorso` (vedi ConteggiTab): i due tab si
 * sovrappongono di proposito — cliccando "In corso" vedi anche le escalation.
 */
export function tabsPraticheAdmin(conteggi: ConteggiTab): TabPratiche[] {
  return [
    { value: '', label: 'Tutte', count: conteggi.tutte },
    { value: 'IN_CORSO', label: 'In corso', count: conteggi.inCorso },
    { value: 'IN_ESCALATION', label: 'In escalation', count: conteggi.escalation },
    { value: 'BOZZA', label: 'Bozze', count: conteggi.bozze },
    { value: 'CONCLUSE', label: 'Concluse', count: conteggi.concluse },
  ];
}

/**
 * Quale tab risulta selezionato dato `?stato=`. Un filtro più fine di qualunque
 * tab (es. `PROCESSATA` scelto dalla select) non ne accende nessuno: mostrare
 * "In corso" attivo mentre vedi solo le processate sarebbe fuorviante.
 */
export function tabAttivo(stato: string | undefined): ValoreTab | null {
  if (!stato) return '';
  if (
    stato === 'IN_CORSO' ||
    stato === 'IN_ESCALATION' ||
    stato === 'BOZZA' ||
    stato === 'CONCLUSE'
  ) {
    return stato;
  }
  return null;
}

export function hrefTab(value: ValoreTab, filtri: FiltriTab, basePath = '/pratiche'): string {
  const qs = new URLSearchParams();
  if (value) qs.set('stato', value);
  if (filtri.q) qs.set('q', filtri.q);
  if (filtri.periodo) qs.set('periodo', filtri.periodo);
  if (filtri.sede) qs.set('sede', filtri.sede);
  const s = qs.toString();
  return s ? `${basePath}?${s}` : basePath;
}

/**
 * Opzioni della select "Stato". Devono restare coerenti coi tab: l'agenzia non
 * ha il tab Bozze (vedi `tabsPratiche`) perché `agenziaSedeId` viene scritto
 * solo all'accettazione (inbox/actions.ts:92) — prima non è ancora "sua". Per
 * lo stesso motivo la select non le deve offrire `BOZZA`/`IN_ATTESA`: sono
 * garantite zero risultati. `SCADUTA` è uno stato legacy che nessun percorso
 * del codice scrive più: non ha senso offrirlo a nessuno dei due ruoli... ma
 * il broker la vedeva già prima di questo fix, quindi resta per non togliere
 * una voce storica senza che sia stato chiesto esplicitamente.
 */
export function opzioniStato({
  isAgenzia,
}: {
  isAgenzia: boolean;
}): { value: string; label: string }[] {
  const comuni = [
    { value: '', label: 'Tutti gli stati' },
    { value: 'IN_CORSO', label: 'In corso' },
    { value: 'CONCLUSE', label: 'Concluse' },
    ...(isAgenzia ? [] : [{ value: 'BOZZA', label: 'Bozza' }]),
    ...(isAgenzia ? [] : [{ value: 'IN_ATTESA', label: 'In attesa' }]),
    { value: 'ACCETTATA', label: 'Accettata' },
    { value: 'PROCESSATA', label: 'Processata' },
    { value: 'FIRMATA', label: 'Firmata' },
    ...(isAgenzia ? [] : [{ value: 'SCADUTA', label: 'Scaduta' }]),
    { value: 'ANNULLATA', label: 'Annullata' },
  ];
  return comuni;
}

/** Filtri che la paginazione deve trascinarsi dietro (oltre a `page`). */
export type FiltriPagina = FiltriTab & { stato?: string };

/**
 * URL di una pagina della lista pratiche, preservando tutti i filtri attivi.
 * `page` viene omesso quando è 1: gli URL restano puliti e condivisibili.
 * Usato sia dal pager sia dal redirect di `?page=` fuori range.
 */
export function hrefPaginaPratiche(
  page: number,
  filtri: FiltriPagina,
  basePath = '/pratiche',
): string {
  const qs = new URLSearchParams();
  if (filtri.stato) qs.set('stato', filtri.stato);
  if (filtri.q) qs.set('q', filtri.q);
  if (filtri.periodo) qs.set('periodo', filtri.periodo);
  if (filtri.sede) qs.set('sede', filtri.sede);
  if (page > 1) qs.set('page', String(page));
  const s = qs.toString();
  return s ? `${basePath}?${s}` : basePath;
}
