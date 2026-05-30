import type {
  EpisodeDetail,
  FeaturedItem,
  PaginatedResponse,
  EpisodeSummary,
  ShowDetail,
  UserSelf,
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

function refreshSession(): boolean {
  const url = `${API}/token/refresh/`;
  const resp = http.POST(url, '', { 'Content-Type': 'application/json' }, true);
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
  let resp = http.GET(url, { 'Accept': 'application/json' }, true);
  if (resp.code === 401 || resp.code === 403) {
    if (refreshSession()) {
      resp = http.GET(url, { 'Accept': 'application/json' }, true);
    }
  }
  return resp;
}

function getJson<T>(url: string, useAuth = false): T {
  const resp = useAuth
    ? authedGet(url)
    : http.GET(url, { 'Accept': 'application/json' }, false);
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

export function getUserSelf(): UserSelf {
  return getJson<UserSelf>(`${API}/user/`, true);
}

export function isSessionActive(): boolean {
  const now = Date.now();
  if (now - lastSessionCheckAt < SESSION_CHECK_CACHE_MS) {
    return lastSessionCheckResult;
  }
  const resp = authedGet(`${API}/user/`);
  lastSessionCheckResult = resp.code === 200;
  lastSessionCheckAt = now;
  return lastSessionCheckResult;
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
