import { describe, it, expect } from 'vitest';
import { parseQa, respondAsBot, type ChatbotConfig } from './index';

const baseBot: ChatbotConfig = {
  id: 'bot-1',
  nome: 'BotTest',
  prompt: 'Sei un assistente di test',
  obiettivo: 'Convertire visitatore',
  qa: '',
  escalation: 'Ti faccio richiamare da un operatore.',
  attivo: true,
};

describe('parseQa', () => {
  it('parses single D:/R: pair', () => {
    const out = parseQa('D: Quanto costa?\nR: La piattaforma è gratuita.');
    expect(out).toEqual([
      { question: 'Quanto costa?', answer: 'La piattaforma è gratuita.' },
    ]);
  });

  it('parses multiple pairs separated by blank lines', () => {
    const out = parseQa(
      'D: Costa qualcosa?\nR: No, gratis.\n\nD: Come firmo?\nR: Con SPID.',
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.question).toBe('Costa qualcosa?');
    expect(out[1]?.answer).toBe('Con SPID.');
  });

  it('tolerates Q:/A: synonyms', () => {
    const out = parseQa('Q: Hello?\nA: Hi there.');
    expect(out).toEqual([{ question: 'Hello?', answer: 'Hi there.' }]);
  });

  it('returns empty array on empty input', () => {
    expect(parseQa('')).toEqual([]);
  });
});

describe('respondAsBot', () => {
  it('returns escalation when no Q&A matches', () => {
    const out = respondAsBot(
      { ...baseBot, qa: 'D: Pricing?\nR: Gratis.' },
      'Vorrei un caffè',
    );
    expect(out.escalated).toBe(true);
    expect(out.reply).toBe(baseBot.escalation);
  });

  it('matches Q&A by keyword overlap', () => {
    const out = respondAsBot(
      { ...baseBot, qa: 'D: Quanto costa il servizio?\nR: Gratis per dealer.' },
      'Mi dite quanto costa?',
    );
    expect(out.escalated).toBe(false);
    expect(out.reply).toBe('Gratis per dealer.');
  });

  it('returns inactive message when bot is disabled', () => {
    const out = respondAsBot({ ...baseBot, attivo: false }, 'Ciao');
    expect(out.escalated).toBe(true);
    expect(out.reply).toContain('temporaneamente non disponibile');
  });

  it('handles empty user message gracefully', () => {
    const out = respondAsBot(baseBot, '   ');
    expect(out.escalated).toBe(false);
    expect(out.reply).toContain('Scrivimi');
  });

  it('prefers higher-scoring Q&A on ambiguous input', () => {
    const qa =
      'D: Cosa serve per registrarsi?\nR: Email e P.IVA.\n\nD: Quanto costa?\nR: Gratis.';
    const out = respondAsBot(
      { ...baseBot, qa },
      'Per registrarsi cosa devo fare?',
    );
    expect(out.reply).toBe('Email e P.IVA.');
  });
});
