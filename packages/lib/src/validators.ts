import { z } from 'zod';

// Validatori italiani comuni - usati sia client che server.

export const partitaIvaSchema = z
  .string()
  .regex(/^\d{11}$/, 'La P.IVA deve essere di 11 cifre');

export const codiceFiscaleSchema = z
  .string()
  .regex(
    /^[A-Z]{6}\d{2}[A-EHLMPR-T]\d{2}[A-Z]\d{3}[A-Z]$/i,
    'Codice fiscale non valido',
  )
  .transform((v) => v.toUpperCase());

export const ibanItSchema = z
  .string()
  .regex(/^IT\d{2}[A-Z0-9]{1,30}$/i, 'IBAN italiano non valido')
  .transform((v) => v.toUpperCase());

export const pecSchema = z.string().email('Email/PEC non valida');

export const capSchema = z.string().regex(/^\d{5}$/, 'CAP non valido');

export const passwordSchema = z
  .string()
  .min(10, 'La password deve avere almeno 10 caratteri')
  .regex(/[A-Z]/, 'Serve almeno una lettera maiuscola')
  .regex(/[a-z]/, 'Serve almeno una lettera minuscola')
  .regex(/\d/, 'Serve almeno un numero');
