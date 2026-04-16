export type EmailProviderName = 'console' | 'resend';

export type EmailSendInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  tag?: string;
};

export type EmailSendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

export interface EmailProvider {
  readonly name: EmailProviderName;
  send(input: EmailSendInput): Promise<EmailSendResult>;
}
