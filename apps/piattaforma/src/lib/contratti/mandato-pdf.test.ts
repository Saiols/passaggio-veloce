import { describe, it, expect } from 'vitest';
import { buildMandatoFatturazionePdf } from './mandato-pdf';
import type { DatiFiscali } from '@/lib/fatturazione/pv-emittente';

const mandante: DatiFiscali = {
  ragioneSociale: 'Auto Rossi S.r.l.', partitaIva: '12345678901', codiceSdi: null, pec: 'rossi@pec.it',
  indirizzo: 'Via Roma 1', cap: '00100', citta: 'Roma', provincia: 'RM',
};
const mandatario: DatiFiscali = {
  ragioneSociale: 'Passaggio Veloce SRL', partitaIva: '14688390963', codiceSdi: null, pec: null,
  indirizzo: 'Via PV 1', cap: '20100', citta: 'Milano', provincia: 'MI',
};

describe('buildMandatoFatturazionePdf', () => {
  it('produce un PDF valido e non banale', async () => {
    const bytes = await buildMandatoFatturazionePdf({
      mandante, mandanteRappresentante: 'Mario Rossi',
      mandatario, mandatarioRappresentante: 'Andrea Saino',
      foro: 'Milano', firmatoAt: new Date('2026-06-28T10:00:00Z'),
      otpAudit: { ip: '1.2.3.4' },
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(1500);
    // header PDF
    const head = new TextDecoder().decode(bytes.slice(0, 5));
    expect(head).toBe('%PDF-');
  });

  it('non lancia con campi minimi / ip null', async () => {
    await expect(
      buildMandatoFatturazionePdf({
        mandante, mandanteRappresentante: '', mandatario, mandatarioRappresentante: 'X',
        foro: 'Milano', firmatoAt: new Date(), otpAudit: { ip: null },
      }),
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});
