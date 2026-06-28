/**
 * Test di integrazione: verifica che tutti i template usino il nuovo layout
 * istituzionale (emailLayout) e che N31 usi il bottone CTA arancio.
 */

import { describe, it, expect } from 'vitest';
import { tplN1BrokerInvio, tplN31ValutaAgenzia, tplN40ClienteAvanzamento, tplN9AgenziaAddebitoFallito } from './templates';
import type { ClienteAvanzamentoStato, ClienteAvanzamentoRuolo } from './templates';

describe('templates usano il nuovo layout', () => {
  it('N1 contiene header navy, logo, footer legale', () => {
    const { html } = tplN1BrokerInvio({
      codicePratica: 'PV-1', targa: 'AB123CD', comune: 'Milano', provincia: 'MI',
      numeroAgenzie: 5, nomeBroker: 'Mario',
    });
    expect(html).toContain('logo-email.png');
    expect(html).toContain('Passaggio Veloce SRL');
    expect(html).toContain('<!--PV_UNSUB-->');
  });

  it('N31 usa il bottone CTA arancio verso praticaUrl', () => {
    const { html } = tplN31ValutaAgenzia({
      codicePratica: 'PV-1', targa: null, agenziaNome: 'Ag', nomeBroker: 'Mario',
      praticaUrl: 'https://passaggioveloce.it/pratiche/1',
    });
    expect(html).toContain('https://passaggioveloce.it/pratiche/1');
    expect(html).toContain('#ff7a00');
  });
});

describe('N40 cliente avanzamento', () => {
  const STATI: ClienteAvanzamentoStato[] = [
    'AVVIATA', 'PRESA_IN_CARICO', 'PRONTA_FIRMA', 'COMPLETATA', 'ANNULLATA',
  ];
  const RUOLI: ClienteAvanzamentoRuolo[] = ['ACQUIRENTE', 'VENDITORE'];

  it('per ogni stato/ruolo: subject e text valorizzati, niente dati commerciali', () => {
    for (const stato of STATI) {
      for (const ruolo of RUOLI) {
        const { subject, text, html } = tplN40ClienteAvanzamento({
          codicePratica: 'PV-2026-001',
          veicoloDescrizione: 'AB123CD',
          nomeDestinatario: 'Mario Rossi',
          ruolo,
          stato,
        });
        expect(subject.length).toBeGreaterThan(0);
        expect(text.length).toBeGreaterThan(0);
        expect(subject).toContain('PV-2026-001');
        expect(text).toContain('PV-2026-001');
        // niente dati commerciali
        // niente dati commerciali (il template non riceve fee/importi/nome
        // agenzia: la menzione generica "un'agenzia partner" è consentita).
        const haystack = `${subject}\n${text}\n${html}`.toLowerCase();
        expect(haystack).not.toContain('€');
        expect(haystack).not.toContain('fee');
        expect(haystack).not.toContain('wallet');
        expect(haystack).not.toContain('saldo');
      }
    }
  });

  it('differenzia acquisto vs vendita all-avvio', () => {
    const base = {
      codicePratica: 'PV-1', veicoloDescrizione: 'AB123CD', nomeDestinatario: 'Mario',
      stato: 'AVVIATA' as const,
    };
    const acq = tplN40ClienteAvanzamento({ ...base, ruolo: 'ACQUIRENTE' });
    const ven = tplN40ClienteAvanzamento({ ...base, ruolo: 'VENDITORE' });
    expect(acq.text.toLowerCase()).toContain('acquisto');
    expect(ven.text.toLowerCase()).toContain('vendita');
  });

  it('gestisce veicoloDescrizione null senza rompere', () => {
    const { text } = tplN40ClienteAvanzamento({
      codicePratica: 'PV-1', veicoloDescrizione: null, nomeDestinatario: 'Mario',
      ruolo: 'ACQUIRENTE', stato: 'COMPLETATA',
    });
    expect(text).toContain('PV-1');
    expect(text).not.toContain('null');
  });
});

describe('N9 addebito fallito agenzia', () => {
  it('contiene il messaggio di sospensione, l\'invito a aggiornare l\'IBAN e il CTA', () => {
    const { subject, text, html } = tplN9AgenziaAddebitoFallito({
      nomeAgenzia: 'Agenzia Rossi',
      rimedioUrl: 'https://passaggioveloce.it/blocco-pagamento',
    });
    expect(subject.length).toBeGreaterThan(0);
    const hay = `${subject}\n${text}\n${html}`.toLowerCase();
    expect(hay).toContain('addebito');
    expect(hay).toContain('iban');
    expect(hay).toContain('sospeso');
    expect(html).toContain('https://passaggioveloce.it/blocco-pagamento');
  });
});
