import type {
  EpisodeDetail,
  FeaturedItem,
  PaginatedResponse,
  EpisodeSummary,
  ShowDetail,
} from './types/gasdigital';

export const BASE = 'https://gasdigital.com';
export const API = `${BASE}/api`;

// Access tokens (gdn-jwt cookie) live for 300s. We refresh against the long-lived
// refresh cookie (gdn-jwtr, ~15 days) via POST /api/token/refresh/, which
// Set-Cookies a new access token (Grayjay's auth http client owns the jar).
// The refresh response body has `access_expiration` (ISO8601) so we can refresh
// proactively without waiting for a 401.

const REFRESH_BUFFER_MS = 30_000; // refresh this far before expiration
const FALLBACK_ACCESS_LIFETIME_MS = 270_000; // 4m30s fallback when body has no expiration
const SESSION_CHECK_CACHE_MS = 60_000; // cache /api/user/ probe result this long

// Transient HTTP status codes worth a single immediate retry. The Grayjay V8
// runtime has no `setTimeout`, so retries must be synchronous — fine for
// load-balancer/proxy hiccups (502/503/504), request timeouts (408), and
// surprise rate-limit responses (429, which gasdigital doesn't surface
// today but is cheap to defend against).
const RETRYABLE_STATUS: ReadonlySet<number> = new Set([408, 429, 502, 503, 504]);
const MAX_HTTP_RETRY = 1;

let accessExpiresAt = 0;
let lastSessionCheckAt = 0;
let lastSessionCheckResult = false;

export interface AuthState {
  accessExpiresAt: number;
}

export function loadAuthState(s: AuthState | null | undefined): void {
  accessExpiresAt = s?.accessExpiresAt ?? 0;
}

export function dumpAuthState(): AuthState {
  return { accessExpiresAt };
}

function needsRefresh(): boolean {
  return accessExpiresAt === 0 || Date.now() >= accessExpiresAt - REFRESH_BUFFER_MS;
}

/**
 * Wraps http.GET / http.POST with:
 *   - a single sync retry on RETRYABLE_STATUS (5xx-ish, 429, 408)
 *   - try/catch around the underlying call so a thrown network error
 *     (DNS, TLS, connection-refused) surfaces as a ScriptException with
 *     enough context to debug from the phone instead of a bare runtime error.
 *
 * Auth-401/403 is NOT retried here — that's the cookie-refresh path's job
 * (see authedGet), which is a different kind of recovery.
 */
function safeHttp(
  method: 'GET' | 'POST',
  url: string,
  body: string | null,
  headers: Record<string, string>,
  useAuth: boolean,
): BridgeHttpResponse {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let resp: BridgeHttpResponse;
    try {
      resp = method === 'POST'
        ? http.POST(url, body ?? '', headers, useAuth)
        : http.GET(url, headers, useAuth);
    } catch (e) {
      if (attempt < MAX_HTTP_RETRY) {
        attempt++;
        log(`${method} ${url}: network error, retrying — ${(e as Error).message}`);
        continue;
      }
      throw new ScriptException(
        `${method} ${url}: network error after ${attempt + 1} attempt(s) — ${(e as Error).message}`,
      );
    }
    if (RETRYABLE_STATUS.has(resp.code) && attempt < MAX_HTTP_RETRY) {
      attempt++;
      log(`${method} ${url}: HTTP ${resp.code}, retrying`);
      continue;
    }
    return resp;
  }
}

function refreshSession(): boolean {
  const url = `${API}/token/refresh/`;
  const resp = safeHttp('POST', url, '', { 'Content-Type': 'application/json' }, true);
  if (resp.code === 401 || resp.code === 403) {
    accessExpiresAt = 0;
    lastSessionCheckAt = 0; // drop stale "logged in" verdict
    return false;
  }
  if (!resp.isOk) {
    log(`refresh: ${url} failed HTTP ${resp.code}`);
    return false;
  }
  try {
    const body = JSON.parse(resp.body) as { access_expiration?: string };
    accessExpiresAt = body.access_expiration
      ? Date.parse(body.access_expiration)
      : Date.now() + FALLBACK_ACCESS_LIFETIME_MS;
  } catch {
    accessExpiresAt = Date.now() + FALLBACK_ACCESS_LIFETIME_MS;
  }
  lastSessionCheckAt = 0; // a fresh access token means the next probe must re-evaluate
  return true;
}

function authedGet(url: string): BridgeHttpResponse {
  if (needsRefresh()) refreshSession();
  let resp = safeHttp('GET', url, null, { 'Accept': 'application/json' }, true);
  if (resp.code === 401 || resp.code === 403) {
    if (refreshSession()) {
      resp = safeHttp('GET', url, null, { 'Accept': 'application/json' }, true);
    }
  }
  return resp;
}

function getJson<T>(url: string, useAuth = false): T {
  const resp = useAuth
    ? authedGet(url)
    : safeHttp('GET', url, null, { 'Accept': 'application/json' }, false);
  if (resp.code === 401 || resp.code === 403) {
    throw new LoginRequiredException(`GET ${url} requires a subscriber session (HTTP ${resp.code})`);
  }
  if (!resp.isOk) {
    // Echo the first chunk of the body — invaluable when debugging from the phone.
    const excerpt = resp.body ? resp.body.slice(0, 200).replace(/\s+/g, ' ') : '';
    throw new ScriptException(`GET ${url} failed: HTTP ${resp.code}${excerpt ? ` — ${excerpt}` : ''}`);
  }
  try {
    return JSON.parse(resp.body) as T;
  } catch (e) {
    throw new ScriptException(`GET ${url}: response was not JSON (${(e as Error).message})`);
  }
}

export function isSessionActive(): boolean {
  const now = Date.now();
  if (now - lastSessionCheckAt < SESSION_CHECK_CACHE_MS) {
    return lastSessionCheckResult;
  }
  try {
    const resp = authedGet(`${API}/user/`);
    lastSessionCheckResult = resp.code === 200;
  } catch (e) {
    log(`isSessionActive probe failed: ${(e as Error).message}`);
    lastSessionCheckResult = false;
  }
  lastSessionCheckAt = now;
  return lastSessionCheckResult;
}

/**
 * Pre-flight check for plugin methods that need a subscriber session. Throws
 * LoginRequiredException — Grayjay's UI catches this and opens the configured
 * authentication webview instead of surfacing a generic error.
 *
 * Uses the 60s session-check cache so repeated calls in quick succession (e.g.
 * a user navigating shows back-to-back) don't each fire a /api/user/ probe.
 */
export function assertLoggedIn(): void {
  if (!isSessionActive()) {
    throw new LoginRequiredException(
      'Gas Digital requires an active subscription — sign in via this source to continue.',
    );
  }
}

// /api/featured/ is public; the catalogue rarely changes within a session, so
// we cache it module-level. All other content endpoints need auth.
let featuredCache: FeaturedItem[] | null = null;

export function getFeatured(): FeaturedItem[] {
  if (featuredCache) return featuredCache;
  featuredCache = getJson<FeaturedItem[]>(`${API}/featured/`);
  return featuredCache;
}

// Channel-tap fans out into getChannel + getChannelContents — both need the
// show detail. Single-entry cache keyed by id is enough since users navigate
// one channel at a time and the next channel-tap will re-fetch.
let showCache: { id: string; detail: ShowDetail } | null = null;

export function getShow(showId: string): ShowDetail {
  if (showCache && showCache.id === showId) return showCache.detail;
  const detail = getJson<ShowDetail>(`${API}/shows/${encodeURIComponent(showId)}/`);
  showCache = { id: showId, detail };
  return detail;
}

export function getEpisode(episodeId: string): EpisodeDetail {
  return getJson<EpisodeDetail>(`${API}/episodes/${encodeURIComponent(episodeId)}/`, true);
}

export function searchByShowName(
  showName: string,
  page = 1,
): PaginatedResponse<EpisodeSummary> {
  const url = `${API}/search/?shows=${encodeURIComponent(showName)}&page=${page}`;
  return getJson<PaginatedResponse<EpisodeSummary>>(url, true);
}

export function fetchUrl<T>(url: string, useAuth = false): T {
  return getJson<T>(url, useAuth);
}
