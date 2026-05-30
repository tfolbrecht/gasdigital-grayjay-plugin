import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockHttp } from './setup';

let api: typeof import('../src/api');
let mappers: typeof import('../src/mappers');

beforeEach(async () => {
  vi.resetModules();
  api = await import('../src/api');
  mappers = await import('../src/mappers');
  mappers.setPluginId('test-plugin');
});

describe('HTTP retry / network-error wrapping (safeHttp)', () => {
  it('retries once on HTTP 503 and returns the recovered response', () => {
    mockHttp({
      'GET https://gasdigital.com/api/featured/': [
        { code: 503, body: 'Service Unavailable' },
        { code: 200, body: '[]' },
      ],
    });
    const out = api.getFeatured();
    expect(out).toEqual([]);
    const featuredCalls = (http.GET as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).endsWith('/api/featured/'),
    );
    expect(featuredCalls).toHaveLength(2);
  });

  it('retries once on HTTP 429 (rate limit) and surfaces success', () => {
    mockHttp({
      'GET https://gasdigital.com/api/featured/': [
        { code: 429, body: '' },
        { code: 200, body: '[]' },
      ],
    });
    expect(api.getFeatured()).toEqual([]);
  });

  it('does NOT retry on a stable 500 — gives up after the retry budget', () => {
    mockHttp({
      'GET https://gasdigital.com/api/featured/': { code: 500, body: 'oops' },
    });
    expect(() => api.getFeatured()).toThrow(/HTTP 500/);
  });

  it('does NOT retry on 401 (auth path handles that separately, not safeHttp)', () => {
    mockHttp({
      'POST https://gasdigital.com/api/token/refresh/': { code: 401, body: '' },
      'GET https://gasdigital.com/api/shows/m1CLX6BWfntK/': { code: 401, body: '' },
    });
    // shows endpoint doesn't use auth → 401 surfaces as LoginRequiredException via getJson
    expect(() => api.getShow('m1CLX6BWfntK')).toThrow(LoginRequiredException);
  });

  it('wraps a thrown http transport error as ScriptException with method + URL', () => {
    (http.GET as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('ENOTFOUND gasdigital.com');
    });
    // retry will fire — make the second call also fail to exhaust the budget
    (http.GET as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('ENOTFOUND gasdigital.com');
    });
    expect(() => api.getFeatured()).toThrow(/network error after 2 attempt/);
    expect(() => api.getFeatured()).toThrow(/GET https:\/\/gasdigital\.com\/api\/featured/);
  });

  it('retries once on a thrown error, then succeeds — transient blip is recovered', () => {
    let attempts = 0;
    (http.GET as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.endsWith('/api/featured/')) {
        attempts++;
        if (attempts === 1) throw new Error('connection reset');
        return { code: 200, body: '[]', url, headers: {}, isOk: true };
      }
      return { code: 404, body: '', url, headers: {}, isOk: false };
    });
    expect(api.getFeatured()).toEqual([]);
    expect(attempts).toBe(2);
  });
});

describe('Mapper guards (defensive against malformed API payloads)', () => {
  it('mapEpisodeDetail throws ScriptException with episode id when playback is missing', () => {
    expect(() =>
      mappers.mapEpisodeDetail({
        type: 'episode',
        id: 'an9QSdzrHE1a',
        sqid: 'an9QSdzrHE1a',
        name: 'EP',
        thumbnail: '',
        description: '',
        show: { id: 's1', name: 'Show', episode_count: 1, thumbnail: '', hosts: [] },
        duration: 0,
        episode: 1,
        date: 0,
        year: 2026,
        month: 1,
        category: 'regular',
        tags: [],
        // playback intentionally missing
      } as never),
    ).toThrow(/episode an9QSdzrHE1a.*missing.*playback/);
  });

  it('mapEpisodeDetail throws ScriptException with episode id when show is missing', () => {
    expect(() =>
      mappers.mapEpisodeDetail({
        type: 'episode',
        id: 'an9QSdzrHE1a',
        sqid: 'an9QSdzrHE1a',
        name: 'EP',
        thumbnail: '',
        description: '',
        duration: 0,
        episode: 1,
        date: 0,
        year: 2026,
        month: 1,
        category: 'regular',
        tags: [],
        playback: 'https://x',
      } as never),
    ).toThrow(/episode an9QSdzrHE1a.*missing.*show/);
  });

  it('mapEpisodeSummary throws ScriptException when id is missing', () => {
    expect(() =>
      mappers.mapEpisodeSummary({
        type: 'episode',
        name: 'EP',
        thumbnail: '',
        description: '',
        show: 'Show',
        duration: 0,
        episode: 1,
        date: 0,
      } as never),
    ).toThrow(/episode summary.*missing.*id/);
  });

  it('mapEpisodeSummary tolerates missing optional fields (show/name/duration)', () => {
    // Real-world: search results occasionally come back without one of these.
    // Should NOT crash — coerce to defaults instead.
    const v = mappers.mapEpisodeSummary({
      type: 'episode',
      id: 'an9QSdzrHE1a',
      thumbnail: '',
    } as never);
    const obj = (v as unknown as { url: string; name: string; duration: number }).obj as
      | { url: string; name: string; duration: number }
      | undefined;
    // The PlatformVideo stub assigns obj fields onto itself — check either path.
    const url = obj?.url ?? (v as unknown as { url: string }).url;
    expect(url).toBe('https://gasdigital.com/view/video/an9QSdzrHE1a');
  });
});
