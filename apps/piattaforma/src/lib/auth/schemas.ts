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
    // errorMap (non `message`) così anche il caso "data vuota → Invalid Date"
    // mostra il messaggio italiano invece del default zod "Invalid date".
    dataNascita: z.coerce.date({
      errorMap: () => ({ message: 'Data di nascita obbligatoria' }),
    }),
    luogoNascita: z.string().min(1, 'Luogo di nascita obbligatorio'),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: 'Le password non coincidono',
    path: ['passwordConfirm'],
  });

export const registerStep2CompanySchema = z
  .object({
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
    civico: z.string().trim().min(1, 'Civico obbligatorio'),
    citta: z.string().min(2, 'Città obbligatoria'),
    cap: capSchema,
    provincia: z.string().length(2, 'Provincia (2 lettere)'),
    // Regime fiscale del broker (FT-A): determina il tipo di documento emesso per
    // suo conto (TD01 ordinario, TD06 forfettario). Richiesto solo per i DEALER
    // (sono i "broker" che maturano compensi); per le agenzie è irrilevante.
    // Self-registration espone ORDINARIO/FORFETTARIO (PRIVATO non ha visura → admin-set).
    regimeFiscale: z.enum(['ORDINARIO', 'FORFETTARIO', 'PRIVATO']).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.type === 'DEALER' && !d.regimeFiscale) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Seleziona il regime fiscale',
        path: ['regimeFiscale'],
      });
    }
  });

// Step 3 (documenti KYC): i file (CI fronte/retro, CF, visura) sono gestiti
// fuori da Zod (FormData). La data emissione visura non è più richiesta a mano:
// sarà estratta/validata dall'OCR sulla visura camerale.

export const registerStep4PaymentSchema = z.object({
  iban: ibanItSchema,
  sepaMandateAccepted: z.literal(true, {
    message: 'Devi accettare il mandato SEPA',
  }),
  termsAccepted: z.literal(true, {
    message: 'Devi accettare i termini e condizioni',
  }),
  // Approvazione specifica delle clausole vessatorie ex artt. 1341-1342 c.c.
  // (raccolta separata dall'accettazione generale, requisito di opponibilità).
  clausoleVessatorieAccepted: z.literal(true, {
    message: 'Devi approvare specificamente le clausole indicate (artt. 1341-1342 c.c.)',
  }),
});

// Step 5 (sedi): unità operative sotto l'azienda madre (multi-sede). La prima è
// pre-compilata dai dati azienda; IBAN/telefono/email opzionali per sede.
export const registerSedeSchema = z.object({
  nome: z.string().trim().min(2, 'Nome sede obbligatorio'),
  indirizzo: z.string().trim().min(2, 'Indirizzo obbligatorio'),
  civico: z.string().trim().optional().default(''),
  citta: z.string().trim().min(2, 'Città obbligatoria'),
  cap: capSchema,
  provincia: z.string().trim().length(2, 'Provincia (2 lettere)'),
  telefono: z.string().trim().optional().default(''),
  email: z.string().trim().optional().default(''),
  // IBAN sede: opzionale, ma se compilato dev'essere un IBAN italiano valido.
  iban: z.union([z.literal(''), ibanItSchema]).optional().default(''),
});

export type RegisterSedeInput = z.infer<typeof registerSedeSchema>;

// Schema completo (concatenazione di tutti gli step) per il submit finale.
// `sedi` è opzionale: se assente, il server deriva 1 sede dai dati azienda.
export const registerFullSchema = z.object({
  account: registerStep1AccountSchema,
  company: registerStep2CompanySchema,
  payment: registerStep4PaymentSchema,
  sedi: z.array(registerSedeSchema).min(1).optional(),
});

export type RegisterFullInput = z.infer<typeof registerFullSchema>;

// ============================================================
// Altri form auth (validazione client, stessi messaggi del server)
// ============================================================

// Accettazione invito dipendente: nome/cognome + password (policy standard).
export const acceptInviteSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obbligatorio'),
  cognome: z.string().trim().min(1, 'Cognome obbligatorio'),
  password: passwordSchema,
});

// Reset password: richiesta (email) e conferma (nuova password, policy standard).
export const resetRequestSchema = z.object({
  email: z.string().email('Email non valida'),
});
export const resetConfirmSchema = z.object({
  password: passwordSchema,
});
