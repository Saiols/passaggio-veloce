import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { escapeHtml } from '@/lib/escape-html';
import type { EmailProvider, EmailSendInput, EmailSendResult } from './types';

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console' as const;

  constructor(private readonly dumpDir: string | null) {}

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const messageId = `console-${randomUUID()}`;
    const banner = '─'.repeat(60);
    console.log(
      [
        '',
        `[email:console] ${banner}`,
        `  message-id: ${messageId}`,
        `  from:       ${input.from ?? '(default)'}`,
        `  to:         ${input.to}`,
        `  subject:    ${input.subject}`,
        input.tag ? `  tag:        ${input.tag}` : null,
        input.replyTo ? `  reply-to:   ${input.replyTo}` : null,
        banner,
        input.text ? `  text:\n${indent(input.text)}` : '  (html only)',
        '',
      ]
        .filter(Boolean)
        .join('\n'),
    );

    if (this.dumpDir) {
      try {
        await mkdir(this.dumpDir, { recursive: true });
        const safe = input.subject.replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
        const file = path.join(this.dumpDir, `${Date.now()}-${safe}.html`);
        await writeFile(file, wrapHtml(input));
      } catch (err) {
        console.warn('[email:console] dump failed', (err as Error).message);
      }
    }

    return { ok: true, messageId };
  }
}

function indent(s: string): string {
  return s
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}

function wrapHtml(input: EmailSendInput): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(input.subject)}</title>
  </head>
  <body style="font-family: system-ui, sans-serif; max-width: 680px; margin: 24px auto; padding: 0 16px">
    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#f8fafc;margin-bottom:16px;font-size:13px;color:#334155">
      <strong>to:</strong> ${escapeHtml(input.to)}<br>
      <strong>from:</strong> ${escapeHtml(input.from ?? '(default)')}<br>
      <strong>subject:</strong> ${escapeHtml(input.subject)}${input.tag ? ` <em style="color:#64748b">(${escapeHtml(input.tag)})</em>` : ''}
    </div>
    ${input.html}
  </body>
</html>`;
}
