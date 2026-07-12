import { describe, it, expect } from 'vitest';
import { tabsPratiche, tabAttivo, hrefTab } from './tabs';

const conteggi = { tutte: 11, inCorso: 4, bozze: 2, concluse: 5 };

describe('tabsPratiche', () => {
  it('il broker vede quattro tab, con i conteggi', () => {
    expect(tabsPratiche({ isAgenzia: false, conteggi })).toEqual([
      { value: '', label: 'Tutte', count: 11 },
      { value: 'IN_CORSO', label: 'In corso', count: 4 },
      { value: 'BOZZA', label: 'Bozze', count: 2 },
      { value: 'CONCLUSE', label: 'Concluse', count: 5 },
    ]);
  });

  it("l'agenzia non vede il tab Bozze: nella sua lista non entrano mai bozze", () => {
    // `agenziaSedeId` viene scritto solo all'accettazione (inbox/actions.ts:92):
    // una pratica in BOZZA non è ancora assegnata, quindi il tab sarebbe sempre 0.
    const tabs = tabsPratiche({ isAgenzia: true, conteggi });
    expect(tabs.map((t) => t.value)).toEqual(['', 'IN_CORSO', 'CONCLUSE']);
  });
});

describe('tabAttivo', () => {
  it('nessun filtro ⇒ tab Tutte', () => {
    expect(tabAttivo(undefined)).toBe('');
    expect(tabAttivo('')).toBe('');
  });

  it('gli aggregati dei tab accendono il tab corrispondente', () => {
    expect(tabAttivo('IN_CORSO')).toBe('IN_CORSO');
    expect(tabAttivo('BOZZA')).toBe('BOZZA');
    expect(tabAttivo('CONCLUSE')).toBe('CONCLUSE');
  });

  it('un filtro fine dalla select non accende nessun tab', () => {
    // "solo Processate" è più stretto di "In corso": accendere "In corso"
    // sarebbe una bugia (mostrerebbe selezionato un tab che non stai vedendo).
    expect(tabAttivo('PROCESSATA')).toBeNull();
    expect(tabAttivo('FIRMATA')).toBeNull();
    expect(tabAttivo('IN_ATTESA')).toBeNull();
  });
});

describe('hrefTab', () => {
  it('il tab Tutte non mette il parametro stato', () => {
    expect(hrefTab('', {})).toBe('/pratiche');
  });

  it('preserva gli altri filtri attivi', () => {
    const href = hrefTab('IN_CORSO', { q: 'AB123CD', periodo: '30d', sede: 'sede-1' });
    expect(href).toBe('/pratiche?stato=IN_CORSO&q=AB123CD&periodo=30d&sede=sede-1');
  });

  it('azzera la paginazione: cambiare tab riporta a pagina 1', () => {
    // `page` non è tra i filtri accettati, quindi non può essere trascinata:
    // restare a pagina 4 su un tab con 2 risultati darebbe una lista vuota.
    expect(hrefTab('BOZZA', { q: '' })).toBe('/pratiche?stato=BOZZA');
  });

  it('codifica i valori: la ricerca può contenere spazi e simboli', () => {
    expect(hrefTab('', { q: 'mario rossi & figli' })).toBe(
      '/pratiche?q=mario+rossi+%26+figli',
    );
  });
});
