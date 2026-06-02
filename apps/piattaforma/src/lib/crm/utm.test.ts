import { describe, it, expect } from 'vitest';
import { parseUtmCookie } from './utm';

describe('parseUtmCookie', () => {
  it('returns all nulls for undefined', () => {
    expect(parseUtmCookie(undefined)).toEqual({
      source: null,
      medium: null,
      campaign: null,
      content: null,
    });
  });

  it('returns all nulls for null', () => {
    expect(parseUtmCookie(null)).toEqual({
      source: null,
      medium: null,
      campaign: null,
      content: null,
    });
  });

  it('returns all nulls for empty string', () => {
    expect(parseUtmCookie('')).toEqual({
      source: null,
      medium: null,
      campaign: null,
      content: null,
    });
  });

  it('returns all nulls for malformed JSON (no throw)', () => {
    expect(parseUtmCookie('not-json{')).toEqual({
      source: null,
      medium: null,
      campaign: null,
      content: null,
    });
  });

  it('parses URL-encoded valid JSON with all four params', () => {
    const raw = encodeURIComponent(
      JSON.stringify({
        source: 'google',
        medium: 'cpc',
        campaign: 'lancio',
        content: 'banner-a',
      }),
    );
    expect(parseUtmCookie(raw)).toEqual({
      source: 'google',
      medium: 'cpc',
      campaign: 'lancio',
      content: 'banner-a',
    });
  });

  it('parses partial cookie (only source) leaving the rest null', () => {
    const raw = encodeURIComponent(JSON.stringify({ source: 'newsletter' }));
    expect(parseUtmCookie(raw)).toEqual({
      source: 'newsletter',
      medium: null,
      campaign: null,
      content: null,
    });
  });

  it('coerces non-string values to null', () => {
    const raw = encodeURIComponent(
      JSON.stringify({
        source: 42,
        medium: { nested: true },
        campaign: ['array'],
        content: 'valido',
      }),
    );
    expect(parseUtmCookie(raw)).toEqual({
      source: null,
      medium: null,
      campaign: null,
      content: 'valido',
    });
  });

  it('truncates overlong values to 200 chars', () => {
    const long = 'a'.repeat(500);
    const raw = encodeURIComponent(JSON.stringify({ source: long }));
    const result = parseUtmCookie(raw);
    expect(result.source).toHaveLength(200);
    expect(result.source).toBe('a'.repeat(200));
  });
});
