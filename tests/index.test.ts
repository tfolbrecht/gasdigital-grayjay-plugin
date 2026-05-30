import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockHttp } from './setup';

// Importing src/index.ts mutates the global `source` object — that's exactly
// what the Grayjay V8 runtime does. Each test sees a fresh module graph so
// the mutations of one test don't bleed into another.

let s: Record<string, Function>;

beforeEach(async () => {
  vi.resetModules();
  (globalThis as Record<string, unknown>).source = {};
  await import('../src/index');
  s = (globalThis as Record<string, Record<string, Function>>).source;
  s.enable!({ id: 'test-plugin', name: 'Gas Digital', description: '' }, {}, null);
});

describe('URL routers', () => {
  it.each([
    ['https://gasdigital.com/show/m1CLX6BWfntK', true],
    ['https://gasdigital.com/show/m1CLX6BWfntK/', true],
    ['https://www.gasdigital.com/show/m1CLX6BWfntK', true],
    ['https://gasdigital.com/view/video/an9QSdzrHE1a', false], // /view/video/ is content, not channel
    ['https://gasdigital.com/show/abc', false], // id too short — must be 6+ chars
    ['https://gasdigital.com/login', false],
    ['https://example.com/show/abc', false],
  ])('isChannelUrl(%s) -> %s', (url, expected) => {
    expect(s.isChannelUrl!(url)).toBe(expected);
  });

  it.each([
    ['https://gasdigital.com/view/video/an9QSdzrHE1a', true],
    ['https://gasdigital.com/view/video/an9QSdzrHE1a/width/100/height/100', true],
    ['https://gasdigital.com/view/video/an9QSdzrHE1a?position=42', true],
    ['https://www.gasdigital.com/view/video/an9QSdzrHE1a', true],
    ['https://gasdigital.com/show/abc', false],
    ['https://example.com/view/video/an9QSdzrHE1a', false],
  ])('isContentDetailsUrl(%s) -> %s', (url, expected) => {
    expect(s.isContentDetailsUrl!(url)).toBe(expected);
  });
});

describe('searchSuggestions', () => {
  it('returns top matches from cached featured list (no API call per keystroke)', () => {
    mockHttp({
      'GET https://gasdigital.com/api/featured/': {
        code: 200,
        body: JSON.stringify([
          { id: 'a', name: 'Fart Carnival', thumbnail: '', category: 'featured' },
          { id: 'b', name: 'The SDR Show', thumbnail: '', category: 'featured' },
          { id: 'c', name: 'Real Ass Podcast', thumbnail: '', category: 'featured' },
        ]),
      },
    });
    const out = s.searchSuggestions!('fart');
    expect(out).toEqual(['Fart Carnival']);
    // Second call should hit the cache, not the network.
    s.searchSuggestions!('sdr');
    const featuredCalls = (http.GET as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).endsWith('/api/featured/'),
    );
    expect(featuredCalls).toHaveLength(1);
  });

  it('empty query returns []', () => {
    expect(s.searchSuggestions!('')).toEqual([]);
  });
});

describe('auth-gated source methods', () => {
  it('getHome throws LoginRequiredException when /api/user/ returns 401', () => {
    mockHttp({
      'POST https://gasdigital.com/api/token/refresh/': { code: 401, body: '' },
      'GET https://gasdigital.com/api/user/': { code: 401, body: '' },
    });
    expect(() => s.getHome!()).toThrow(LoginRequiredException);
  });

  it('getContentDetails throws LoginRequiredException up-front (no episode call attempted)', () => {
    mockHttp({
      'POST https://gasdigital.com/api/token/refresh/': { code: 401, body: '' },
      'GET https://gasdigital.com/api/user/': { code: 401, body: '' },
    });
    expect(() => s.getContentDetails!('https://gasdigital.com/view/video/an9QSdzrHE1a')).toThrow(
      LoginRequiredException,
    );
    // /api/episodes/abc/ must NOT have been called — failing the session probe should short-circuit.
    const epCalls = (http.GET as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes('/api/episodes/'),
    );
    expect(epCalls).toHaveLength(0);
  });

  it('getContentDetails ScriptException when URL is malformed (before assertLoggedIn fires)', () => {
    expect(() => s.getContentDetails!('https://gasdigital.com/show/abc')).toThrow(ScriptException);
  });
});

describe('lifecycle', () => {
  it('disable does not throw', () => {
    expect(() => s.disable!()).not.toThrow();
  });

  it('saveState round-trips through enable(savedState)', () => {
    const saved = s.saveState!() as string;
    expect(typeof saved).toBe('string');
    const parsed = JSON.parse(saved);
    expect(parsed).toHaveProperty('accessExpiresAt');
  });

  it('getShorts returns an empty pager (gasdigital has no shorts)', () => {
    const p = s.getShorts!() as { results: unknown[]; hasMore: boolean };
    expect(p.results).toEqual([]);
    expect(p.hasMore).toBe(false);
  });

  it('getChannelTemplateByClaimMap returns an empty map (no Polycentric claim registered yet)', () => {
    expect(s.getChannelTemplateByClaimMap!()).toEqual({});
  });
});
