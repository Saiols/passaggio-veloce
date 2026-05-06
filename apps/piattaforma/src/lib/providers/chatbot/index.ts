/**
 * Stub provider chatbot. Implementa il matching Q&A configurate sul bot
 * con keyword/substring search case-insensitive sul testo della domanda.
 * Quando si attiverà un LLM provider (OpenAI/Manychat) si sostituirà la
 * funzione `respondAsBot` mantenendo la stessa firma.
 *
 * Spec: docs/crm-spec-implementativa.md §6 (Bundle CRM-D punto 4).
 */

export type ChatbotConfig = {
  id: string;
  nome: string;
  prompt: string;
  obiettivo: string;
  qa: string;
  escalation: string;
  attivo: boolean;
};

export type ChatbotReply = {
  reply: string;
  escalated: boolean;
};

/**
 * Parsa il testo Q&A configurato sul bot in un array `{question, answer}`.
 * Formato accettato: blocchi `D: ... / R: ...` separati da riga vuota o
 * intercalati. Tollerante a `Q:`/`A:` per compatibilità.
 */
export function parseQa(qa: string): { question: string; answer: string }[] {
  const out: { question: string; answer: string }[] = [];
  if (!qa) return out;

  const lines = qa.split(/\r?\n/);
  let curQ: string | null = null;
  let curA: string[] = [];

  const flush = (): void => {
    if (curQ && curA.length) {
      out.push({ question: curQ.trim(), answer: curA.join('\n').trim() });
    }
    curQ = null;
    curA = [];
  };

  for (const raw of lines) {
    const m = raw.match(/^\s*(D|Q):\s*(.*)$/i);
    const r = raw.match(/^\s*(R|A):\s*(.*)$/i);
    if (m) {
      flush();
      curQ = m[2] ?? '';
    } else if (r && curQ !== null) {
      curA.push(r[2] ?? '');
    } else if (curQ !== null && curA.length > 0) {
      // continuazione risposta multi-riga
      curA.push(raw);
    }
  }
  flush();
  return out;
}

/**
 * Matching greedy: per ogni Q&A calcola un punteggio basato sul numero
 * di parole-chiave (≥3 char) della domanda configurata che compaiono
 * nel messaggio utente. Soglia minima: 1 keyword.
 */
function findBestMatch(
  qa: { question: string; answer: string }[],
  message: string,
): { answer: string; score: number } | null {
  const m = message.toLowerCase();
  let best: { answer: string; score: number } | null = null;
  for (const item of qa) {
    const keywords = item.question
      .toLowerCase()
      .split(/[^a-zà-ÿ0-9]+/)
      .filter((k) => k.length >= 3);
    if (keywords.length === 0) continue;
    let score = 0;
    for (const k of keywords) {
      if (m.includes(k)) score++;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { answer: item.answer, score };
    }
  }
  return best;
}

/**
 * Calcola la risposta del bot al messaggio utente.
 * Stub: matcha sulle Q&A configurate. Se nessun match, restituisce il
 * messaggio di escalation. Quando il bot non è attivo, restituisce un
 * messaggio neutro di indisponibilità.
 */
export function respondAsBot(
  bot: ChatbotConfig,
  message: string,
): ChatbotReply {
  if (!bot.attivo) {
    return {
      reply:
        'Il chatbot è temporaneamente non disponibile. Scrivici a info@passaggioveloce.it e ti rispondiamo prima possibile.',
      escalated: true,
    };
  }
  const trimmed = (message ?? '').trim();
  if (!trimmed) {
    return {
      reply: 'Scrivimi pure la tua domanda — sono qui per aiutarti.',
      escalated: false,
    };
  }
  const qa = parseQa(bot.qa);
  const match = findBestMatch(qa, trimmed);
  if (match) {
    return { reply: match.answer, escalated: false };
  }
  return {
    reply: bot.escalation,
    escalated: true,
  };
}
