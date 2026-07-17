import { describe, it, expect } from 'vitest';
import {
  tplN50AgenziaRevocata,
  tplN51BrokerRimessaInCircolo,
  tplN40ClienteAvanzamento,
} from './templates';

describe('template revoca/ricircolo', () => {
  it('N50: informa l\'agenzia della revoca con codice e motivo', () => {
    const c = tplN50AgenziaRevocata({
      codicePratica: 'PV-2026-001', targa: 'AB123CD', nomeAgenzia: 'Auto MI', motivo: 'ferma da giorni',
    });
    expect(c.subject).toContain('PV-2026-001');
    expect(c.text).toContain('Auto MI');
    expect(c.text).toContain('ferma da giorni');
    expect(c.html).toContain('PV-2026-001');
  });

  it('N51: informa il broker della rimessa in circolo', () => {
    const c = tplN51BrokerRimessaInCircolo({ codicePratica: 'PV-2026-002', targa: null, nomeBroker: 'Rossi' });
    expect(c.subject).toContain('PV-2026-002');
    expect(c.text).toContain('Rossi');
    expect(c.text.toLowerCase()).toContain('distribuzione');
  });

  it('N40: arm RIMESSA_IN_CIRCOLO non mostra l\'indirizzo agenzia', () => {
    const c = tplN40ClienteAvanzamento({
      codicePratica: 'PV-2026-003', veicoloDescrizione: 'AB123CD', nomeDestinatario: 'Mario',
      ruolo: 'ACQUIRENTE', stato: 'RIMESSA_IN_CIRCOLO',
      agenziaNome: 'NON DEVE COMPARIRE', agenziaIndirizzo: 'Via X', agenziaCitta: 'Roma',
    });
    expect(c.subject).toContain('PV-2026-003');
    expect(c.html).not.toContain('NON DEVE COMPARIRE');
  });
});
