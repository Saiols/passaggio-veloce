'use client';

import { useEffect, useRef, useState } from 'react';

type ChatMsg = {
  role: 'bot' | 'user';
  text: string;
  escalated?: boolean;
};

export function ChatbotWidget({
  botId,
  botNome,
  greeting,
}: {
  botId: string;
  botNome: string;
  greeting: string;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: 'bot', text: greeting },
  ]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  const send = async (): Promise<void> => {
    const trimmed = input.trim();
    if (!trimmed || pending) return;
    const nextMsgs: ChatMsg[] = [...messages, { role: 'user', text: trimmed }];
    setMessages(nextMsgs);
    setInput('');
    setPending(true);
    // Storico multi-turn: ultimi 12 messaggi, mappati al formato API.
    const history = nextMsgs.slice(-12).map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.text,
    }));
    try {
      const res = await fetch(`/api/chatbot/${botId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });
      const data = (await res.json()) as {
        reply?: string;
        escalated?: boolean;
        error?: string;
      };
      const reply =
        data.reply ?? data.error ?? 'Errore di rete, riprova tra poco.';
      setMessages((m) => [
        ...m,
        { role: 'bot', text: reply, escalated: data.escalated },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: 'bot',
          text: 'Errore di rete, riprova tra poco.',
          escalated: true,
        },
      ]);
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-40 sm:bottom-6 sm:right-6"
    >
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-pv-navy-700 text-white shadow-[0_8px_24px_rgb(10_37_64_/_0.30)] transition hover:bg-pv-navy-800 focus-visible:outline-none focus-visible:shadow-[var(--pv-ring-focus)]"
          aria-label={`Apri chat con ${botNome}`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {open && (
        <div className="pointer-events-auto flex h-[520px] w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[0_12px_32px_rgb(10_37_64_/_0.25)] sm:w-[380px]">
          <header className="flex items-center justify-between bg-pv-navy-700 px-4 py-3 text-white">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-bold">💬 {botNome}</p>
              <p className="text-[11px] text-white/70">Online · risponde in pochi secondi</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Chiudi chat"
              className="text-[20px] leading-none text-white/80 hover:text-white"
            >
              ×
            </button>
          </header>

          <div
            ref={scrollRef}
            className="flex-1 space-y-2 overflow-y-auto bg-pv-slate-50 px-3 py-3"
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  'max-w-[85%] rounded-[12px] px-3 py-2 text-[13px] leading-relaxed ' +
                  (m.role === 'bot'
                    ? 'mr-auto bg-white text-pv-navy-900 shadow-[var(--pv-shadow-card)]'
                    : 'ml-auto bg-pv-navy-700 text-white')
                }
              >
                {m.text}
                {m.escalated && m.role === 'bot' && (
                  <span className="mt-1 block text-[10.5px] font-bold uppercase tracking-wider text-pv-orange-500">
                    ⚠ richiesta escalation
                  </span>
                )}
              </div>
            ))}
            {pending && (
              <div className="mr-auto max-w-[85%] rounded-[12px] bg-white px-3 py-2 text-[13px] text-pv-slate-500 shadow-[var(--pv-shadow-card)]">
                <span className="inline-flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-pv-slate-400 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-pv-slate-400 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-pv-slate-400" />
                </span>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex items-center gap-2 border-t border-pv-slate-200 bg-white px-3 py-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Scrivi un messaggio..."
              maxLength={1000}
              disabled={pending}
              className="flex-1 rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px] focus:outline-none focus:border-pv-navy-700"
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              className="rounded-[10px] bg-pv-navy-700 px-3 py-2 text-[13px] font-bold text-white transition hover:bg-pv-navy-800 disabled:opacity-50"
              aria-label="Invia messaggio"
            >
              ↑
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
