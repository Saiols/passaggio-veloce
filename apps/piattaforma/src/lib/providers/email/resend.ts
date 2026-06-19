import 'server-only';
import { Resend } from 'resend';
import type { EmailProvider, EmailSendInput, EmailSendResult } from './types';

/**
 * Provider email Resend (region EU / eu-west-1).
 *
 * Mappa l'interfaccia interna `EmailSendInput` sul payload SDK Resend e
 * normalizza la risposta `{ data, error }` nel discriminated union
 * `EmailSendResult`. Errori di rete/SDK sono catturati e ritornati come
 * `{ ok: false }` (mai throw) così il sender centrale può registrare il
 * fallimento senza far cadere il flusso chiamante.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend' as const;
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly defaultFrom: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    try {
      const { data, error } = await this.client.emails.send({
        from: input.from ?? this.defaultFrom,
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        ...(input.tag
          ? { tags: [{ name: 'categoria', value: sanitizeTagValue(input.tag) }] }
          : {}),
        ...(input.attachments?.length
          ? {
              attachments: input.attachments.map((a) => ({
                filename: a.filename,
                // L'SDK accetta string (base64) o Buffer: i Uint8Array (es.
                // output di pdf-lib) vanno convertiti in Buffer.
                content: typeof a.content === 'string' ? a.content : Buffer.from(a.content),
                ...(a.contentType ? { contentType: a.contentType } : {}),
              })),
            }
          : {}),
      });

      if (error) {
        return { ok: false, error: error.message || error.name || 'Resend error' };
      }
      if (!data?.id) {
        return { ok: false, error: 'Resend: risposta senza id' };
      }
      return { ok: true, messageId: data.id };
    } catch (err) {
      return { ok: false, error: (err as Error).message || 'Resend: errore sconosciuto' };
    }
  }
}

/**
 * Le tag Resend ammettono solo lettere ASCII, cifre, `_` e `-` (max 256).
 * Sanifichiamo il valore (es. nome NotificaTipo) per evitare 422 dall'API.
 */
function sanitizeTagValue(tag: string): string {
  return tag.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 256);
}
