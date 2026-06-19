export type EmailProviderName = 'console' | 'resend';

/**
 * Allegato email. `content` è il contenuto binario (es. PDF generato in
 * memoria) o una stringa base64. Il `contentType` è opzionale: se assente
 * Resend lo deriva dall'estensione del filename.
 */
export type EmailAttachment = {
  filename: string;
  content: Buffer | Uint8Array | string;
  contentType?: string;
};

export type EmailSendInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  tag?: string;
  attachments?: EmailAttachment[];
};

export type EmailSendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

export interface EmailProvider {
  readonly name: EmailProviderName;
  send(input: EmailSendInput): Promise<EmailSendResult>;
}
