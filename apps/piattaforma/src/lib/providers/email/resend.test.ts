import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { ResendEmailProvider } from './resend';

const make = () => new ResendEmailProvider('re_test', 'noreply@passaggioveloce.it');

describe('ResendEmailProvider', () => {
  beforeEach(() => sendMock.mockReset());

  it('mappa il successo in {ok:true, messageId} e applica il from di default', async () => {
    sendMock.mockResolvedValue({ data: { id: 'em_123' }, error: null });
    const r = await make().send({ to: 'a@b.it', subject: 'Ciao', html: '<p>hi</p>' });
    expect(r).toEqual({ ok: true, messageId: 'em_123' });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@passaggioveloce.it',
        to: 'a@b.it',
        subject: 'Ciao',
        html: '<p>hi</p>',
      }),
    );
  });

  it('usa il from fornito e mappa replyTo + tag sanitizzata', async () => {
    sendMock.mockResolvedValue({ data: { id: 'em_1' }, error: null });
    await make().send({
      to: 'a@b.it',
      subject: 's',
      html: '<p/>',
      from: 'x@p.it',
      replyTo: 'r@p.it',
      tag: 'N31_VALUTA AGENZIA!',
    });
    const payload = sendMock.mock.calls[0]![0];
    expect(payload.from).toBe('x@p.it');
    expect(payload.replyTo).toBe('r@p.it');
    expect(payload.tags).toEqual([{ name: 'categoria', value: 'N31_VALUTA_AGENZIA_' }]);
  });

  it('include text solo se presente', async () => {
    sendMock.mockResolvedValue({ data: { id: 'em_1' }, error: null });
    await make().send({ to: 'a@b.it', subject: 's', html: '<p/>' });
    expect(sendMock.mock.calls[0]![0]).not.toHaveProperty('text');
    await make().send({ to: 'a@b.it', subject: 's', html: '<p/>', text: 'plain' });
    expect(sendMock.mock.calls[1]![0].text).toBe('plain');
  });

  it('non passa attachments se assenti o vuoti', async () => {
    sendMock.mockResolvedValue({ data: { id: 'em_1' }, error: null });
    await make().send({ to: 'a@b.it', subject: 's', html: '<p/>' });
    expect(sendMock.mock.calls[0]![0]).not.toHaveProperty('attachments');
    await make().send({ to: 'a@b.it', subject: 's', html: '<p/>', attachments: [] });
    expect(sendMock.mock.calls[1]![0]).not.toHaveProperty('attachments');
  });

  it('converte il contenuto Uint8Array in Buffer e propaga filename + contentType', async () => {
    sendMock.mockResolvedValue({ data: { id: 'em_1' }, error: null });
    await make().send({
      to: 'a@b.it',
      subject: 's',
      html: '<p/>',
      attachments: [
        { filename: 'fattura-1-2026.pdf', content: new Uint8Array([1, 2, 3]), contentType: 'application/pdf' },
      ],
    });
    const att = sendMock.mock.calls[0]![0].attachments;
    expect(att).toHaveLength(1);
    expect(att[0].filename).toBe('fattura-1-2026.pdf');
    expect(att[0].contentType).toBe('application/pdf');
    expect(Buffer.isBuffer(att[0].content)).toBe(true);
    expect([...att[0].content]).toEqual([1, 2, 3]);
  });

  it('lascia invariato un contenuto stringa (base64) e omette contentType se assente', async () => {
    sendMock.mockResolvedValue({ data: { id: 'em_1' }, error: null });
    await make().send({
      to: 'a@b.it',
      subject: 's',
      html: '<p/>',
      attachments: [{ filename: 'doc.pdf', content: 'YmFzZTY0' }],
    });
    const att = sendMock.mock.calls[0]![0].attachments;
    expect(att[0].content).toBe('YmFzZTY0');
    expect(att[0]).not.toHaveProperty('contentType');
  });

  it('mappa error Resend in {ok:false, error}', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'dominio non verificato' },
    });
    const r = await make().send({ to: 'a@b.it', subject: 's', html: '<p/>' });
    expect(r).toEqual({ ok: false, error: 'dominio non verificato' });
  });

  it('cattura le eccezioni di rete in {ok:false}', async () => {
    sendMock.mockImplementationOnce(async () => {
      throw new Error('network down');
    });
    const r = await make().send({ to: 'a@b.it', subject: 's', html: '<p/>' });
    expect(r).toEqual({ ok: false, error: 'network down' });
  });

  it('ritorna {ok:false} se la risposta non ha id', async () => {
    sendMock.mockResolvedValue({ data: {}, error: null });
    const r = await make().send({ to: 'a@b.it', subject: 's', html: '<p/>' });
    expect(r.ok).toBe(false);
  });
});
