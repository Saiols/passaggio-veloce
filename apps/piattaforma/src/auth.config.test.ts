import { describe, it, expect } from 'vitest';
import { authConfig } from './auth.config';

// Il callback `authorized` classifica le rotte in pubbliche (raggiungibili da
// utente anonimo) vs protette. Queste esenzioni non erano coperte da test: il
// link /i/<token> dell'email di partenza è arrivato in prod dietro il gate auth
// (redirect a /login) prima che una richiesta anonima lo smascherasse. Questo
// test blocca la regressione per /i/ e, già che c'è, per /r/ e una rotta protetta.
const authorized = authConfig.callbacks!.authorized!;

function mockReq(pathname: string, host = 'localhost:3100') {
  return {
    nextUrl: new URL(`http://${host}${pathname}`),
    headers: new Headers({ host }),
  };
}

describe('auth.config authorized — rotte pubbliche pre-login', () => {
  it('/i/<token>: link email di partenza raggiungibile da lead anonimo', () => {
    const res = authorized({ auth: null, request: mockReq('/i/tok') } as never);
    expect(res).toBe(true);
  });

  it('/r/<code>: link affiliazione resta pubblico (regressione)', () => {
    const res = authorized({ auth: null, request: mockReq('/r/code') } as never);
    expect(res).toBe(true);
  });

  it('/unsubscribe: pubblico via isPublicPath', () => {
    const res = authorized({ auth: null, request: mockReq('/unsubscribe') } as never);
    expect(res).toBe(true);
  });

  it('/dashboard: protetto, utente anonimo non autorizzato', () => {
    const res = authorized({ auth: null, request: mockReq('/dashboard') } as never);
    expect(res).toBe(false);
  });
});
