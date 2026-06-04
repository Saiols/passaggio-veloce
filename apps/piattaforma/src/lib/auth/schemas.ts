import { z } from 'zod';
import {
  capSchema,
  codiceFiscaleSchema,
  ibanItSchema,
  partitaIvaSchema,
  passwordSchema,
  pecSchema,
} from '@pv/lib';

export const loginSchema = z.object({
  email: z.string().email('Email non valida'),
  password: z.string().min(1, 'Password obbligatoria'),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ============================================================
// Wizard registrazione - 4 step
// ============================================================

export const registerStep1AccountSchema = z
  .object({
    email: z.string().email('Email non valida'),
    password: passwordSchema,
    passwordConfirm: z.string(),
    nome: z.string().min(1, 'Nome obbligatorio'),
    cognome: z.string().min(1, 'Cognome obbligatorio'),
    codiceFiscale: codiceFiscaleSchema,
    dataNascita: z.coerce.date({ message: 'Data di nascita obbligatoria' }),
    luogoNascita: z.string().min(1, 'Luogo di nascita obbligatorio'),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: 'Le password non coincidono',
    path: ['passwordConfirm'],
  });

export const registerStep2CompanySchema = z.object({
  type: z.enum(['DEALER', 'AGENZIA'], {
    message: 'Seleziona il tipo di azienda',
  }),
  ragioneSociale: z.string().min(2, 'Ragione sociale obbligatoria'),
  partitaIva: partitaIvaSchema,
  codiceSdi: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{7}$/, 'Codice SDI: 7 caratteri alfanumerici'),
  pec: pecSchema,
  email: z.string().email('Email aziendale non valida'),
  telefono: z.string().trim().min(8, 'Numero di telefono obbligatorio'),
  indirizzo: z.string().min(2, 'Indirizzo obbligatorio'),
  citta: z.string().min(2, 'Città obbligatoria'),
  cap: capSchema,
  provincia: z.string().length(2, 'Provincia (2 lettere)'),
});

// Step 3 (documenti KYC): i file (CI fronte/retro, CF, visura) sono gestiti
// fuori da Zod (FormData) perché File non è serializzabile/validabile qui.
// Lo schema valida solo la data di emissione della visura camerale.
export const registerStep3DocumentsSchema = z.object({
  visuraData: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data di emissione della visura obbligatoria'),
});

export type RegisterStep3DocumentsInput = z.infer<typeof registerStep3DocumentsSchema>;

export const registerStep4PaymentSchema = z.object({
  iban: ibanItSchema,
  sepaMandateAccepted: z.literal(true, {
    message: 'Devi accettare il mandato SEPA',
  }),
  termsAccepted: z.literal(true, {
    message: 'Devi accettare i termini e condizioni',
  }),
});

// Schema completo (concatenazione di tutti gli step) per il submit finale.
export const registerFullSchema = z.object({
  account: registerStep1AccountSchema,
  company: registerStep2CompanySchema,
  payment: registerStep4PaymentSchema,
});

export type RegisterFullInput = z.infer<typeof registerFullSchema>;
