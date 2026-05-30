import {
  assertLoggedIn,
  dumpAuthState,
  getEpisode,
  getFeatured,
  getShow,
  isSessionActive,
  loadAuthState,
  searchByShowName,
  type AuthState,
} from './api';
import {
  mapEpisodeDetail,
  mapFeaturedToChannel,
  mapShowToChannel,
  setPluginId,
} from './mappers';
import {
  GasDigitalMultiShowPager,
  GasDigitalShowEpisodePager,
  rememberShow,
} from './pagers';

// /show/<id>           — show landing page (channel in Grayjay terms)
// /view/video/<id>     — episode player (content details in Grayjay terms);
//                        live URLs carry trailing /width/<W>/height/<H>?position=<s>
// `www.` prefix tolerated for pasted URLs.
// ID length bound at {6,32}: real sqids are 12 chars; bound rejects pathological
// inputs early without false-rejecting future id-format changes.
const SHOW_URL_RE = /^https?:\/\/(?:www\.)?gasdigital\.com\/show\/([A-Za-z0-9_-]{6,32})(?:[/?#].*)?$/;
const EPISODE_URL_RE = /^https?:\/\/(?:www\.)?gasdigital\.com\/view\/video\/([A-Za-z0-9_-]{6,32})(?:[/?#].*)?$/;

function extractId(url: string, re: RegExp): string | null {
  const m = url.match(re);
  return m ? m[1]! : null;
}

source.enable = function (config, _settings, savedState) {
  // enable() is the de-facto post-login callback — Grayjay reloads the entire
  // JS context after StatePlugins.setPluginAuth + StatePlatform.reloadClient,
  // so every authed http.GET below this point will carry the captured cookies.
  setPluginId(config.id as string);
  if (savedState) {
    try {
      loadAuthState(JSON.parse(savedState) as AuthState);
    } catch (e) {
      log(`enable: failed to parse savedState: ${(e as Error).message}`);
    }
  }
};

source.disable = function () {
  // no-op
};

source.saveState = function () {
  return JSON.stringify(dumpAuthState());
};

// ---------- Home ----------

source.getHome = function () {
  // Cached public catalogue + lazy per-show fetch via pager.
  // Pre-flight the session so an empty home doesn't masquerade as "no content" —
  // unauthed users get a clean login prompt instead.
  assertLoggedIn();
  const featured = getFeatured();
  return new GasDigitalMultiShowPager(featured);
};

source.getShorts = function () {
  // Gas Digital is exclusively long-form podcast video — no short-form content.
  // Explicitly returning an empty pager so Grayjay's Shorts surface is a no-op
  // instead of an unhandled call.
  return new VideoPager([], false);
};

// ---------- Search ----------

source.getSearchCapabilities = function () {
  // Only long-form podcast video on this platform — no live streams in search,
  // no shorts. Mixed type lets Grayjay merge with other sources without filtering.
  return new ResultCapabilities([Type.Feed.Videos, Type.Feed.Mixed], [Type.Order.Chronological], []);
};

source.searchSuggestions = function (query) {
  // Client-side over the cached featured list — zero API calls per keystroke.
  if (!query) return [];
  const q = query.toLowerCase();
  return getFeatured()
    .filter((s) => s.name.toLowerCase().includes(q))
    .slice(0, 8)
    .map((s) => s.name);
};

source.search = function (query, _type, _order, _filters) {
  if (!query) return new VideoPager([], false);
  assertLoggedIn();
  const featured = getFeatured();
  const q = query.toLowerCase();
  const matches = featured.filter((s) => s.name.toLowerCase().includes(q));

  if (matches.length === 0) return new VideoPager([], false);

  // Exact match: surface that show's full paginated episode list.
  const exact = matches.find((s) => s.name.toLowerCase() === q);
  if (exact) {
    rememberShow(exact.name, exact.id);
    return new GasDigitalShowEpisodePager(searchByShowName(exact.name, 1));
  }

  // Otherwise: latest from each matching show, lazy-loaded.
  return new GasDigitalMultiShowPager(matches);
};

source.searchChannels = function (query) {
  const q = query.toLowerCase();
  const matches = getFeatured().filter((s) => s.name.toLowerCase().includes(q));
  return new ChannelPager(matches.map(mapFeaturedToChannel), false);
};

// ---------- Channel (Show) ----------

source.isChannelUrl = function (url) {
  return SHOW_URL_RE.test(url);
};

source.getChannel = function (url) {
  const id = extractId(url, SHOW_URL_RE);
  if (!id) throw new ScriptException(`Not a Gas Digital show URL: ${url}`);
  const show = getShow(id);
  rememberShow(show.name, show.id);
  return mapShowToChannel(show);
};

source.getChannelCapabilities = function () {
  return new ResultCapabilities([Type.Feed.Videos], [Type.Order.Chronological], []);
};

source.getChannelContents = function (url) {
  const id = extractId(url, SHOW_URL_RE);
  if (!id) throw new ScriptException(`Not a Gas Digital show URL: ${url}`);
  // /api/search/?shows= requires auth — fail fast with LoginRequiredException
  // so Grayjay opens the login webview instead of surfacing HTTP 401.
  assertLoggedIn();
  const show = getShow(id);
  rememberShow(show.name, show.id);
  return new GasDigitalShowEpisodePager(searchByShowName(show.name, 1));
};

// ---------- Polycentric ----------

source.getChannelTemplateByClaimMap = function () {
  // Gas Digital isn't yet mapped to a polycentric-core ClaimType. Return an
  // empty map so Grayjay's cross-platform channel resolution skips us cleanly
  // rather than null-checking. Populate when a claim type is registered.
  return {};
};

// ---------- Content Details ----------

source.isContentDetailsUrl = function (url) {
  return EPISODE_URL_RE.test(url);
};

source.getContentDetails = function (url) {
  const id = extractId(url, EPISODE_URL_RE);
  if (!id) throw new ScriptException(`Not a Gas Digital episode URL: ${url}`);
  // /api/episodes/{id}/ requires auth. The session probe is cached for 60s so
  // tapping multiple episodes in quick succession doesn't re-probe each time.
  assertLoggedIn();
  const ep = getEpisode(id);
  rememberShow(ep.show.name, ep.show.id);
  return mapEpisodeDetail(ep);
};

// ---------- Auth ----------

source.isLoggedIn = function () {
  try {
    return isSessionActive();
  } catch {
    return false;
  }
};

log('Gas Digital plugin loaded');
