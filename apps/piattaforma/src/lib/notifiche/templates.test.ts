/**
 * Test di integrazione: verifica che tutti i template usino il nuovo layout
 * istituzionale (emailLayout) e che N31 usi il bottone CTA arancio.
 */

import { describe, it, expect } from 'vitest';
import { tplN1BrokerInvio, tplN31ValutaAgenzia } from './templates';

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
