import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockHttp } from './setup';

// Each test imports api.ts fresh so module-level state
// (accessExpiresAt, lastSessionCheckAt, featuredCache, showCache)
// starts clean.

let api: typeof import('../src/api');

beforeEach(async () => {
  vi.resetModules();
  api = await import('../src/api');
});

describe('assertLoggedIn / isSessionActive', () => {
  it('throws LoginRequiredException when /api/user/ returns 401', () => {
    mockHttp({
      'POST https://gasdigital.com/api/token/refresh/': { code: 401, body: '' },
      'GET https://gasdigital.com/api/user/': { code: 401, body: '' },
    });
    expect(() => api.assertLoggedIn()).toThrow(LoginRequiredException);
  });

  it('passes when /api/user/ returns 200', () => {
    mockHttp({
      'POST https://gasdigital.com/api/token/refresh/': {
        code: 200,
        body: JSON.stringify({ access_expiration: new Date(Date.now() + 300_000).toISOString() }),
      },
      'GET https://gasdigital.com/api/user/': { code: 200, body: '{}' },
    });
    expect(() => api.assertLoggedIn()).not.toThrow();
  });

  it('caches the session-active verdict for 60 s (single probe across many calls)', () => {
    mockHttp({
      'POST https://gasdigital.com/api/token/refresh/': {
        code: 200,
        body: JSON.stringify({ access_expiration: new Date(Date.now() + 300_000).toISOString() }),
      },
      'GET https://gasdigital.com/api/user/': { code: 200, body: '{}' },
    });
    api.assertLoggedIn();
    api.assertLoggedIn();
    api.assertLoggedIn();
    // 1 refresh + 1 user probe — second/third calls hit the 60s cache
    const userCalls = (http.GET as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'https://gasdigital.com/api/user/',
    );
    expect(userCalls).toHaveLength(1);
  });
});

describe('refresh flow', () => {
  it('on a 401 retry, refresh once and retry the original GET', async () => {
    // Sequence: refresh (proactive — needsRefresh is true initially) succeeds,
    // then GET /api/user/ returns 401, then the retry's refresh succeeds, then
    // the retry GET returns 200.
    mockHttp({
      'POST https://gasdigital.com/api/token/refresh/': [
        {
          code: 200,
          body: JSON.stringify({ access_expiration: new Date(Date.now() + 300_000).toISOString() }),
        },
        {
          code: 200,
          body: JSON.stringify({ access_expiration: new Date(Date.now() + 300_000).toISOString() }),
        },
      ],
      'GET https://gasdigital.com/api/user/': [
        { code: 401, body: '' },
        { code: 200, body: '{}' },
      ],
    });
    expect(api.isSessionActive()).toBe(true);
    // Both refreshes fired (one proactive, one reactive) and both GETs fired.
    expect((http.POST as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    const userCalls = (http.GET as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'https://gasdigital.com/api/user/',
    );
    expect(userCalls).toHaveLength(2);
  });

  it('caches the "not logged in" verdict so failed probes do not hammer the server', () => {
    mockHttp({
      'POST https://gasdigital.com/api/token/refresh/': { code: 401, body: '' },
      'GET https://gasdigital.com/api/user/': { code: 401, body: '' },
    });
    expect(() => api.assertLoggedIn()).toThrow(LoginRequiredException);
    expect(() => api.assertLoggedIn()).toThrow(LoginRequiredException);
    expect(() => api.assertLoggedIn()).toThrow(LoginRequiredException);
    // Only ONE round of /api/user/ traffic — subsequent calls served from cache.
    const userCalls = (http.GET as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).endsWith('/api/user/'),
    );
    expect(userCalls).toHaveLength(1);
  });
});

describe('getJson error surfaces', () => {
  it('surfaces HTTP 500 body excerpt in the ScriptException message', () => {
    mockHttp({
      'GET https://gasdigital.com/api/featured/': { code: 500, body: '{"detail":"boom"}' },
    });
    expect(() => api.getFeatured()).toThrow(/HTTP 500.*boom/);
  });

  it('throws ScriptException (not SyntaxError) when the response is non-JSON', () => {
    mockHttp({
      'GET https://gasdigital.com/api/featured/': { code: 200, body: '<html>oops</html>' },
    });
    expect(() => api.getFeatured()).toThrow(/response was not JSON/);
  });

  it('translates 401 into LoginRequiredException (not ScriptException) on auth-gated calls', () => {
    mockHttp({
      'POST https://gasdigital.com/api/token/refresh/': { code: 401, body: '' },
      'GET https://gasdigital.com/api/episodes/abc/': { code: 401, body: '' },
    });
    expect(() => api.getEpisode('abc')).toThrow(LoginRequiredException);
  });
});

describe('caches', () => {
  it('getFeatured is cached after the first hit', () => {
    mockHttp({
      'GET https://gasdigital.com/api/featured/': { code: 200, body: '[]' },
    });
    api.getFeatured();
    api.getFeatured();
    api.getFeatured();
    const featuredCalls = (http.GET as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).endsWith('/api/featured/'),
    );
    expect(featuredCalls).toHaveLength(1);
  });

  it('getShow caches one entry — same id served from cache, different id refetches', () => {
    mockHttp({
      'GET https://gasdigital.com/api/shows/aaa/': { code: 200, body: '{"id":"aaa","name":"A"}' },
      'GET https://gasdigital.com/api/shows/bbb/': { code: 200, body: '{"id":"bbb","name":"B"}' },
    });
    // Re-prime the responses since the single-entry cache is keyed by id.
    api.getShow('aaa');
    api.getShow('aaa');
    api.getShow('bbb');
    api.getShow('aaa');
    const showCalls = (http.GET as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes('/api/shows/'),
    );
    // aaa once, bbb once, aaa once more (since cache was kicked to bbb)
    expect(showCalls).toHaveLength(3);
  });
});

describe('authState persistence', () => {
  it('saves and restores accessExpiresAt across modules', () => {
    api.loadAuthState({ accessExpiresAt: 1_780_000_000_000 });
    expect(api.dumpAuthState()).toEqual({ accessExpiresAt: 1_780_000_000_000 });
  });

  it('null savedState is a no-op (stays at 0)', () => {
    api.loadAuthState(null);
    expect(api.dumpAuthState().accessExpiresAt).toBe(0);
  });
});
