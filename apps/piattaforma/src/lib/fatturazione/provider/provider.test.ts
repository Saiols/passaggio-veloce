import { describe, it, expect } from 'vitest';
import { MockFatturazioneProvider } from './mock';
import { getFatturazioneProvider } from './index';

const EMISSIONE = {
  xml: '<?xml version="1.0"?><p:FatturaElettronica/>',
  nomeFile: 'IT12345678901_00007.xml',
  riferimento: 'doc-abc-123',
};

describe('MockFatturazioneProvider', () => {
  it('emetti: ritorna idSdi deterministico dal riferimento, stato INVIATO, xmlKey', async () => {
    const p = new MockFatturazioneProvider();
    const r1 = await p.emetti(EMISSIONE);
    const r2 = await p.emetti(EMISSIONE);
    expect(r1.idSdi).toBe(r2.idSdi); // deterministico
    expect(r1.idSdi).toContain('doc-abc-123');
    expect(r1.stato).toBe('INVIATO');
    expect(r1.xmlKey).toBeTruthy();
  });

  it('statoSdi: avanza a CONSEGNATO con data di aggiornamento', async () => {
    const p = new MockFatturazioneProvider();
    const s = await p.statoSdi('MOCK-doc-abc-123');
    expect(s.idSdi).toBe('MOCK-doc-abc-123');
    expect(s.stato).toBe('CONSEGNATO');
    expect(s.dataAggiornamento).toBeInstanceOf(Date);
  });

  it('parseWebhook: normalizza un payload valido', () => {
    const p = new MockFatturazioneProvider();
    const ev = p.parseWebhook({ idSdi: 'MOCK-x', stato: 'SCARTATO' });
    expect(ev).not.toBeNull();
    expect(ev?.idSdi).toBe('MOCK-x');
    expect(ev?.stato).toBe('SCARTATO');
    expect(ev?.dataAggiornamento).toBeInstanceOf(Date);
  });

  it('parseWebhook: ritorna null su payload non valido', () => {
    const p = new MockFatturazioneProvider();
    expect(p.parseWebhook(null)).toBeNull();
    expect(p.parseWebhook({ idSdi: 'x', stato: 'BOH' })).toBeNull();
    expect(p.parseWebhook({ foo: 'bar' })).toBeNull();
  });
});

describe('getFatturazioneProvider', () => {
  it('default → mock', () => {
    const p = getFatturazioneProvider(undefined);
    expect(p.nome).toBe('mock');
  });

  it('"mock" esplicito → mock', () => {
    expect(getFatturazioneProvider('mock').nome).toBe('mock');
  });

  it('"acube" senza configurazione → errore esplicito (non ancora attivo)', () => {
    expect(() => getFatturazioneProvider('acube')).toThrow(/acube/i);
  });

  it('provider sconosciuto → errore', () => {
    expect(() => getFatturazioneProvider('pippo')).toThrow();
  });
});
