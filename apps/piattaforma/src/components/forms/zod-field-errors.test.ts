import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodFieldErrors, hasBlockingErrors } from './zod-field-errors';

const schema = z
  .object({
    email: z.string().email('Email non valida'),
    password: z.string().min(1, 'Password obbligatoria'),
    conferma: z.string(),
  })
  .refine((d) => d.password === d.conferma, {
    message: 'Le password non coincidono',
    path: ['conferma'],
  });

describe('zodFieldErrors', () => {
  it('nessun errore su valori validi', () => {
    expect(zodFieldErrors(schema, { email: 'a@b.it', password: 'x', conferma: 'x' })).toEqual({});
  });
  it('mappa la issue sul nome del campo (path[0])', () => {
    const e = zodFieldErrors(schema, { email: 'nope', password: 'x', conferma: 'x' });
    expect(e).toEqual({ email: 'Email non valida' });
  });
  it('più campi invalidi → una entry per campo', () => {
    const e = zodFieldErrors(schema, { email: 'nope', password: '', conferma: '' });
    expect(e.email).toBe('Email non valida');
    expect(e.password).toBe('Password obbligatoria');
  });
  it('prima issue vince per lo stesso campo', () => {
    const s = z.object({ p: z.string().min(2, 'primo').regex(/\d/, 'secondo') });
    expect(zodFieldErrors(s, { p: 'a' }).p).toBe('primo');
  });
  it('refine cross-field finisce sul path indicato', () => {
    const e = zodFieldErrors(schema, { email: 'a@b.it', password: 'x', conferma: 'y' });
    expect(e).toEqual({ conferma: 'Le password non coincidono' });
  });
});

describe('hasBlockingErrors', () => {
  it('false su mappa vuota', () => expect(hasBlockingErrors({})).toBe(false));
  it('false se tutti i valori sono undefined', () =>
    expect(hasBlockingErrors({ a: undefined })).toBe(false));
  it('true se almeno un messaggio è presente', () =>
    expect(hasBlockingErrors({ a: undefined, b: 'x' })).toBe(true));
});
