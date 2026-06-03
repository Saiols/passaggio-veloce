import { describe, it, expect } from 'vitest';
import { tplRegistrazioneConferma, tplResetPassword, tplInvitoTeam } from './email-templates';

describe('tplRegistrazioneConferma', () => {
  const base = {
    nome: 'Mario', ragioneSociale: 'Rossi Auto', verifyUrl: 'https://pv.it/verify-email?token=abc',
    loginUrl: 'https://pv.it/login',
  } as const;

  it('usa il layout istituzionale e i dati utente, senza token unsub', () => {
    const { html, subject } = tplRegistrazioneConferma({ ...base, tipo: 'DEALER', needsVerification: true });
    expect(subject).toContain('Rossi Auto');
    expect(html).toContain('logo-email.png');
    expect(html).toContain('Passaggio Veloce SRL');
    expect(html).toContain('Mario');
    expect(html).not.toContain('<!--PV_UNSUB-->');
  });

  it('DEALER mostra il copy dealer e non quello agenzia', () => {
    const { html } = tplRegistrazioneConferma({ ...base, tipo: 'DEALER', needsVerification: true });
    expect(html).toContain('creare pratiche');
    expect(html).not.toContain('ricevi le pratiche dei dealer');
  });

  it('AGENZIA mostra il copy agenzia e non quello dealer', () => {
    const { html } = tplRegistrazioneConferma({ ...base, tipo: 'AGENZIA', needsVerification: true });
    expect(html).toContain('ricevi le pratiche dei dealer');
    expect(html).not.toContain('creare pratiche');
  });

  it('needsVerification=true → CTA verso verifyUrl con label di conferma', () => {
    const { html } = tplRegistrazioneConferma({ ...base, tipo: 'DEALER', needsVerification: true });
    expect(html).toContain('https://pv.it/verify-email?token=abc');
    expect(html).toContain('Conferma');
    expect(html).toContain('24 ore');
  });

  it('needsVerification=false → CTA verso login + nota account attivo', () => {
    const { html } = tplRegistrazioneConferma({ ...base, tipo: 'DEALER', needsVerification: false });
    expect(html).toContain('https://pv.it/login');
    expect(html).toContain('già attivo');
    expect(html).not.toContain('verify-email');
  });
});

describe('tplResetPassword', () => {
  it('layout + CTA verso resetUrl, niente token unsub', () => {
    const { html, subject } = tplResetPassword({ resetUrl: 'https://pv.it/reset-password?token=z' });
    expect(subject).toContain('password');
    expect(html).toContain('logo-email.png');
    expect(html).toContain('https://pv.it/reset-password?token=z');
    expect(html).not.toContain('<!--PV_UNSUB-->');
  });
});

describe('tplInvitoTeam', () => {
  it('layout + CTA verso inviteUrl + ragione sociale', () => {
    const { html, subject } = tplInvitoTeam({ ragioneSociale: 'Rossi Auto', inviteUrl: 'https://pv.it/invito/t' });
    expect(subject).toContain('Rossi Auto');
    expect(html).toContain('https://pv.it/invito/t');
    expect(html).toContain('Rossi Auto');
    expect(html).not.toContain('<!--PV_UNSUB-->');
  });
});
