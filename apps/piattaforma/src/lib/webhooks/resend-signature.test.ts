import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verificaFirmaResend } from './resend-signature';

// Segreto d'esempio della documentazione Svix (formato `whsec_<base64>`).
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

/**
 * Schema Svix: si firma `${id}.${timestamp}.${body}` con HMAC-SHA256, usando
 * come chiave i byte base64-decodificati del segreto (senza il prefisso
 * `whsec_`). L'header porta `v1,<firma base64>`.
 */
function headersFirmati(body: string, id = 'msg_test'): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  const firma = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${firma}`,
  };
}

describe('verificaFirmaResend', () => {
  const body = JSON.stringify({ type: 'email.opened', data: { email_id: 'e1' } });

  it('accetta una firma valida e ritorna il payload', () => {
    const out = verificaFirmaResend(body, headersFirmati(body), SECRET);
    expect(out).toMatchObject({ type: 'email.opened' });
  });

  it('rifiuta se il body è stato alterato di un byte', () => {
    const headers = headersFirmati(body);
    const out = verificaFirmaResend(body.replace('e1', 'e2'), headers, SECRET);
    expect(out).toBeNull();
  });

  it('rifiuta headers assenti o spazzatura senza lanciare', () => {
    expect(verificaFirmaResend(body, {}, SECRET)).toBeNull();
    expect(
      verificaFirmaResend(
        body,
        { 'svix-id': 'x', 'svix-timestamp': '1', 'svix-signature': 'v1,zzz' },
        SECRET,
      ),
    ).toBeNull();
  });
});
