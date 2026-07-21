import { describe, it, expect } from 'vitest';
import {
  tabsPratiche,
  tabAttivo,
  hrefTab,
  opzioniStato,
  opzioniStatoAdmin,
  hrefPaginaPratiche,
  tabsPraticheAdmin,
} from './tabs';

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

describe('basePath', () => {
  it('di default punta a /pratiche (comportamento invariato)', () => {
    expect(hrefTab('IN_CORSO', {})).toBe('/pratiche?stato=IN_CORSO');
    expect(hrefPaginaPratiche(2, {})).toBe('/pratiche?page=2');
  });

  it('con basePath punta alla lista admin, preservando i filtri', () => {
    expect(hrefTab('IN_ESCALATION', { q: 'AB123' }, '/admin/pratiche')).toBe(
      '/admin/pratiche?stato=IN_ESCALATION&q=AB123',
    );
    expect(hrefPaginaPratiche(3, { stato: 'BOZZA' }, '/admin/pratiche')).toBe(
      '/admin/pratiche?stato=BOZZA&page=3',
    );
  });

  it('tab "Tutte" e pagina 1 non sporcano l’URL', () => {
    expect(hrefTab('', {}, '/admin/pratiche')).toBe('/admin/pratiche');
    expect(hrefPaginaPratiche(1, {}, '/admin/pratiche')).toBe('/admin/pratiche');
  });
});

describe('tabsPraticheAdmin', () => {
  const conteggi = { tutte: 10, inCorso: 5, escalation: 2, bozze: 1, concluse: 4 };

  it('ha i sei tab, con attesa firma ed escalation dopo In corso', () => {
    expect(tabsPraticheAdmin(conteggi, 3).map((t) => t.value)).toEqual([
      '',
      'IN_CORSO',
      'ATTESA_FIRMA',
      'IN_ESCALATION',
      'BOZZA',
      'CONCLUSE',
    ]);
  });

  it('il tab escalation mostra il suo conteggio, non quello di In corso', () => {
    const t = tabsPraticheAdmin(conteggi, 3).find((x) => x.value === 'IN_ESCALATION');
    expect(t?.count).toBe(2);
  });

  it('IN_ESCALATION accende il suo tab', () => {
    expect(tabAttivo('IN_ESCALATION')).toBe('IN_ESCALATION');
  });

  // Un filtro fine dalla select (es. R2) non accende nessun tab: mostrare "In
  // corso" attivo mentre vedi solo le R2 sarebbe fuorviante.
  it('un filtro fine non accende nessun tab', () => {
    expect(tabAttivo('IN_ATTESA_ROUND_2')).toBeNull();
  });

  it('include il tab In attesa di firma col suo conteggio', () => {
    const conteggi = { tutte: 20, inCorso: 8, escalation: 1, bozze: 2, concluse: 10 };
    const tabs = tabsPraticheAdmin(conteggi, 5);
    expect(tabs.map((t) => t.value)).toEqual([
      '',
      'IN_CORSO',
      'ATTESA_FIRMA',
      'IN_ESCALATION',
      'BOZZA',
      'CONCLUSE',
    ]);
    expect(tabs.find((t) => t.value === 'ATTESA_FIRMA')?.count).toBe(5);
  });

  it('tabAttivo riconosce ATTESA_FIRMA', () => {
    expect(tabAttivo('ATTESA_FIRMA')).toBe('ATTESA_FIRMA');
  });
});

describe('opzioniStatoAdmin (I-1)', () => {
  // Bug reale: la select admin (STATI, in admin/pratiche/page.tsx) non
  // conteneva IN_CORSO né CONCLUSE. Con `?stato=IN_CORSO` (arrivo dal tab)
  // nessuna <option> matchava il defaultValue, il browser selezionava "Tutti
  // gli stati" e il form — ad auto-submit su ogni filtro — rinviava `stato=""`
  // al primo tocco: il tab spariva senza errori. Ogni valore prodotto dai tab
  // admin deve avere un'opzione corrispondente nella select, altrimenti si
  // ripresenta esattamente questo difetto.
  it('ogni valore dei tab admin ha una option corrispondente nella select', () => {
    const conteggi = { tutte: 1, inCorso: 1, escalation: 1, bozze: 1, concluse: 1 };
    const valoriTab = tabsPraticheAdmin(conteggi, 1).map((t) => t.value);
    const valoriOpzioni = opzioniStatoAdmin().map((o) => o.value);
    for (const v of valoriTab) {
      expect(valoriOpzioni).toContain(v);
    }
  });

  it('include comunque i valori fini (round/escalation) che l’admin filtra e il broker no', () => {
    const valori = opzioniStatoAdmin().map((o) => o.value);
    expect(valori).toEqual(
      expect.arrayContaining([
        'IN_DISTRIBUZIONE',
        'IN_ATTESA_ROUND_1',
        'IN_ATTESA_ROUND_2',
        'IN_ATTESA_ROUND_3',
        'ACCETTATA',
        'PROCESSATA',
        'FIRMATA',
        'BOZZA',
        'SCADUTA',
        'ANNULLATA',
      ]),
    );
  });

  it('"Tutti gli stati" resta la prima voce', () => {
    expect(opzioniStatoAdmin()[0]).toEqual({ value: '', label: 'Tutti gli stati' });
  });
});
