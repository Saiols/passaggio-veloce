import { describe, it, expect } from 'vitest';
import { tabsPratiche, tabAttivo, hrefTab, opzioniStato, hrefPaginaPratiche } from './tabs';

const conteggi = { tutte: 11, inCorso: 4, escalation: 0, bozze: 2, concluse: 5 };

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

describe('opzioniStato', () => {
  it('il broker vede tutte le voci, incluse Bozza/In attesa/Scaduta', () => {
    const opzioni = opzioniStato({ isAgenzia: false });
    expect(opzioni.map((o) => o.value)).toEqual([
      '',
      'IN_CORSO',
      'CONCLUSE',
      'BOZZA',
      'IN_ATTESA',
      'ACCETTATA',
      'PROCESSATA',
      'FIRMATA',
      'SCADUTA',
      'ANNULLATA',
    ]);
  });

  it("l'agenzia non vede Bozza/In attesa/Scaduta: in agenda danno sempre zero risultati", () => {
    // `agenziaSedeId` viene scritto solo all'accettazione (inbox/actions.ts:92) e
    // SCADUTA non è mai scritto da nessun percorso del codice: offrirle nella
    // select porterebbe l'agenzia a una lista garantita vuota.
    const opzioni = opzioniStato({ isAgenzia: true });
    const values = opzioni.map((o) => o.value);
    expect(values).not.toContain('BOZZA');
    expect(values).not.toContain('IN_ATTESA');
    expect(values).not.toContain('SCADUTA');
    expect(values).toEqual([
      '',
      'IN_CORSO',
      'CONCLUSE',
      'ACCETTATA',
      'PROCESSATA',
      'FIRMATA',
      'ANNULLATA',
    ]);
  });
});

describe('hrefPaginaPratiche', () => {
  it('omette il parametro page quando è 1', () => {
    expect(hrefPaginaPratiche(1, {})).toBe('/pratiche');
  });

  it('preserva tutti i filtri e aggiunge page quando >1', () => {
    expect(
      hrefPaginaPratiche(2, { stato: 'IN_CORSO', q: 'AB123CD', periodo: '30d', sede: 'sede-1' }),
    ).toBe('/pratiche?stato=IN_CORSO&q=AB123CD&periodo=30d&sede=sede-1&page=2');
  });

  it('nessun filtro attivo e page 1 ⇒ URL nuda', () => {
    expect(hrefPaginaPratiche(1, { stato: '', q: '', periodo: '', sede: '' })).toBe('/pratiche');
  });
});
