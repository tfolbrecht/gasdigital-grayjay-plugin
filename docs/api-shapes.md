# gasdigital.com — API surface for the Grayjay plugin

Mapped via headed Playwright MCP against a live, logged-in `Member Level 2` /
`subscription_status: Active` account on 2026-05-30. Every endpoint listed
below was hit; status code + response shape is real.

All paths under `https://gasdigital.com`. Authentication is HttpOnly cookies
delivered by `POST /api/login/`:

| Cookie | Carries | TTL |
|---|---|---|
| `gdn-jwt` | access token | **300 s** (5 min) |
| `gdn-jwtr` | refresh token | **~15 days** |

The plugin never sees the JWTs directly — Grayjay's webview captures them via
`cookiesToFind: ["gdn-jwt", "gdn-jwtr"]` and the bridge's `JSHttpClient` applies
them on every `http.GET(url, headers, true)`.

## TL;DR for the plugin

| Surface | Endpoint(s) the plugin should consume |
|---|---|
| Catalogue | `GET /api/featured/` (cheap, sufficient) and/or `GET /api/shows/` (richer descriptions + tags) |
| Channel detail | `GET /api/shows/{id}/` |
| Channel contents | `GET /api/search/?shows=<show.name>&page=N` — paginated by `next` cursor |
| Content detail | `GET /api/episodes/{id}/` — returns `.playback` HLS master URL |
| Generic search | `GET /api/search/?q=<query>&page=N` |
| Playlist channels | `GET /api/playlists/` |
| Playlist contents | `GET /api/search/?playlists=<playlist.name>&page=N` |
| Schedule view | `GET /api/schedule/` (day-keyed) |
| Live banner | `GET /api/banner/livenow/` |
| Live "up next" | `GET /api/live/` (includes a `.playback` HLS URL) |
| Session probe | `GET /api/user/` |
| Refresh | `POST /api/token/refresh/` (cookie-only, empty body) |
| Logout | `POST /api/logout/` |
| Watch progress | `POST /api/user/metrics/` `{sqid, position, event}` |
| Watch history | `GET /api/user/metrics/?history=true&home=true` |

Page size is **fixed at 25** — `limit` and `page_size` are ignored. The
`results[]` always carries the episode summary shape; `count`, `next`,
`previous` are the DRF pagination fields. Pagination = follow `next` URL.

## Auth (cookies-only after login)

### `POST /api/login/`

- Public (anyone can attempt).
- Body: `{ "email": "...", "password": "..." }`.
- Response (200):
  ```json
  {
    "access":  "<jwt>",
    "refresh": "<jwt>",
    "access_expiration":  "2026-05-30T23:07:13.414331Z",
    "refresh_expiration": "2026-06-14T23:02:13.414335Z",
    "user": {
      "id": "string",
      "email": "string",
      "display_name": "string",
      "display_name_updated": "string | null",
      "preferences": {},
      "avatar": "string",
      "latest_metric": 1780180599310,
      "user_level": 0,
      "member_level": 2,
      "member_status": "string | null",
      "subscription_status": "Active",
      "subscription_renewal": "2026-06-30T20:30:15Z",
      "subscription_source": "WordPress"
    }
  }
  ```
- Side effect: `Set-Cookie: gdn-jwt=…; HttpOnly; Max-Age=300` + `gdn-jwtr=…; HttpOnly; Max-Age=…`.

### `POST /api/token/refresh/`

- Body: empty (`{}` works too). Auth: refresh cookie.
- Response (200):
  ```json
  {
    "access": "<jwt>",
    "access_expiration": "2026-05-30T23:08:14.700025Z"
  }
  ```
- Side effect: `Set-Cookie: gdn-jwt=…; HttpOnly; Max-Age=300`.

### `POST /api/logout/`

- Auth required. Returns `{"detail": "Successfully logged out."}` (200). **Invalidates the refresh cookie** server-side. Plugin should call this on explicit user "Sign Out" and avoid hitting it accidentally during probes.

### `GET /api/user/`

- Auth required (401 anon).
- Response: same shape as `login.user` (the user fields, no JWTs).
- **Use as the session-validity probe** — what `assertLoggedIn()` already does.

### Negative results

- `POST /api/token/blacklist/` → 404
- `GET /api/user/me/`, `/api/user/preferences/`, `/api/user/subscriptions/`, `/api/user/history/`, `/api/user/watchlist/`, `/api/user/favorites/`, `/api/user/notifications/` → all 404

## Catalogue

### `GET /api/featured/`

- **Public** (200 anon).
- Returns 41 entries — all shows + playlists tagged as featured/archived/exclusives/playlists.
- Shape: `Array<{ id, name, thumbnail, category }>`.
- Cheapest catalogue call — what the plugin already caches.

### `GET /api/shows/`

- **Public** (200 anon).
- Returns 36 entries — shows only (no playlists). Richer than `/featured/`:
  ```json
  {
    "id": "m1CLX6BWfntK",
    "name": "The SDR Show",
    "description": "<long blurb>",
    "thumbnail": "...",
    "hosts": "Ralph Sutton,Aaron Berg",
    "category": "featured",
    "episode_count": 963,
    "tags": "[\"...\"]"
  }
  ```
- Accepts `?category=featured` and `?ordering=name` but **both appear to be ignored** (same 36 returned).
- Worth using only if the plugin wants descriptions/tags upfront on home; otherwise stick to `/featured/`.

### `GET /api/shows/{id}/`

- **Public** (200 anon).
- Channel detail. Compared to what the plugin already consumes, the live response carries several extras the plugin could surface:
  ```json
  {
    "type": "show",
    "id": "m1CLX6BWfntK",
    "sqid": "m1CLX6BWfntK",
    "slug": "the-sdr-show",
    "name": "The SDR Show",
    "short_name": "SDR",
    "show": "The SDR Show",
    "description": "...",
    "episode_count": 963,
    "live_schedule": "Wed, Sat at 8:00 PM ET / 5:00 PM PT",
    "category": "featured",
    "tags": [],
    "thumbnail": "...",
    "poster": "...",
    "hosts": [{ "id", "full_name", "profile_image" }],
    "hosts_compact": "Ralph Sutton,Aaron Berg",
    "episode_categories": [
      { "name": "Bonus", "description": "..." },
      { "name": "Green Room", "description": "..." },
      { "name": "regular", "description": "..." }
    ],
    "platform_links": [
      { "name": "Spotify", "code": "SP", "url": "..." },
      ...
    ],
    "youtube_playlist_id": "string | null",
    "art19_show_id": "string | null"
  }
  ```
- The plugin already pipes `platform_links` into `PlatformChannel.links`. `episode_categories` could feed `getChannelCapabilities()` filter groups (Bonus / Green Room / regular).

### `GET /api/playlists/`

- **Public** (200 anon).
- 5 entries (curator-made compilations spanning multiple shows):
  ```json
  {
    "id": "sr0aoAjpKXMd",
    "type": null,
    "name": "LOS Classic",
    "description": "Classic Legion of Skanks episodes…",
    "thumbnail": "...",
    "slug": "los-classic",
    "category": "playlists",
    "poster": "...",
    "episode_count": 94,
    "tags": []
  }
  ```

### `GET /api/playlists/{id}/`

- **Public**. Detail of one playlist — same shape, plus `sqid`.
- **`/api/playlists/{id}/episodes/` is 404.** To list a playlist's episodes, use `/api/search/?playlists=<playlist.name>` (see below).

### `GET /api/slideshows/Mf9Enz4WQyvL/`

- **Public**. Hero carousel for the home page. 15 slides:
  ```json
  {
    "id": "Mf9Enz4WQyvL",
    "slides": [{
      "id": "...",
      "order": 1,
      "poster": "https://...png",
      "headline": "A Decade of GaS Digital",
      "detail_text": "...",
      "button_text": "MORE",
      "button_link": { "type": "inapp", "url": "/playlist/kcg6BA2otx5P" },
      "show": "<showId> | null"
    }, ...]
  }
  ```
- The slideshow ID is hardcoded in the SPA. Could be used by the plugin as a curated home hero, but rotation is editorial.

### `GET /api/banner/livenow/`

- **Auth required** (401 anon).
- ```json
  {
    "show_id": "m1CLX6BWfntK",
    "button_text": "UP NEXT",
    "headline": "The SDR Show",
    "link": "/show/m1CLX6BWfntK",
    "message": "8:00 PM ET Sat",
    "transition": 1780185600
  }
  ```
- `transition` is unix seconds. Useful for a "live now / up next" badge.

### `GET /api/live/`

- **Auth required**. Up-next live program with playback URL:
  ```json
  {
    "up_next": {
      "show":     { id, name, episode_count, live_schedule, thumbnail, hosts[] },
      "name":     "The SDR Show",
      "description": "...",
      "time":     "...",
      "duration": <s>,
      "poster":   "...",
      "playback": "<Kaltura HLS URL>",
      "id":       "..."
    }
  }
  ```
- Could power a `Type.Feed.Live` surface in `getHome` when `transition` is near.

### `GET /api/schedule/`

- **Public**. Day-of-week keyed:
  ```json
  {
    "Monday":    [{ name, show_id, time, link, thumbnail, poster }, ...],
    "Tuesday":   [...],
    "Wednesday": [...],
    "Thursday":  [...],
    "Friday":    [...],
    "Saturday":  [...]
  }
  ```
- Note **no Sunday** key (no programming).

## Search / channel contents

### `GET /api/search/`

- **Auth required** (401 anon). Returns 400 without any of the trigger params.
- Param matrix:

| Param | Form | Behavior |
|---|---|---|
| `q` | string | Free-text. Matches episode `name` + `description` (highlight markup in description: `_**term**_`). |
| `shows` | string (show **name**, not id) | Restrict to one show's episodes. Multiple `shows=` AND-filter (zero results when intersection is empty). |
| `playlists` | string (playlist **name**) | Restrict to one playlist's episodes. `playlists=<id>` returns empty — must be name. |
| `hosts` | string (host full name) | Restrict to episodes featuring host. Multiple `hosts=` AND. |
| `duration_min`, `duration_max` | seconds | Server-side filter. |
| `year_min`, `year_max` | int | Release-year filter. |
| `episode_min`, `episode_max` | int | Episode-number filter (within show). |
| `ordering` | `date` or `-date` | Chronological. Default `-date` (newest first). |
| `page` | int | Pagination (page size **fixed at 25**). |
| `type`, `limit`, `page_size`, `categories`, `tags`, `query`, `episodes` | — | **Ignored or return 400.** Don't use. |

- Must provide at least one of `q`, `shows`, `playlists`, `hosts` — otherwise 400 `{"detail": "Missing search query"}`.
- Response:
  ```json
  {
    "count": 161,
    "next": "https://gasdigital.com/api/search/?q=cannon&page=2",
    "previous": null,
    "results": [{
      "type": "episode",
      "id": "Wv9bKt1gE96W",
      "name": "...",
      "thumbnail": "<Kaltura JPG, width/400>",
      "description": "...",
      "show": "The Real Ass Podcast",
      "duration": 6023,
      "episode": 328,
      "date": 1549483087,
      "thumbnail_remote": {
        "id": "...",
        "url": "<Kaltura base>",
        "extension": "jpg",
        "width": 1400,
        "height": 1400
      }
    }, ...],
    "filters": {
      "shows":  ["The Real Ass Podcast", ...],     // ≤20 shows in this result set
      "hosts":  ["Ralph Sutton", "Aaron Berg", ...], // ≤20 hosts
      "episode_meta": {
        "duration_min": 0, "duration_max": 7089,
        "year_min": 2014, "year_max": 2026,
        "episode_min": 1, "episode_max": 991
      }
    }
  }
  ```
- The `filters` block is sticky-faceted — represents the available shows/hosts/ranges *within* the current result set. Feeds Grayjay's `FilterGroup`/`FilterCapability` UI naturally.

### Caveat: `hosts=` field is stringly typed

The `filters.hosts` array sometimes contains stringified Python lists (`"['Ralph Sutton'", " 'Aaron Berg']"`) — the server is doing string repr on a list. Treat as a hint; dedupe + sanitize before binding to a UI control.

## Episode detail

### `GET /api/episodes/{id}/`

- **Auth required** (401 anon).
- Returns:
  ```json
  {
    "type": "episode",
    "id":   "rjI5pOVCB3s4",
    "sqid": "rjI5pOVCB3s4",
    "slug": "the-sdr-show",
    "name": "SDR #924 …",
    "show": {
      "id": "m1CLX6BWfntK",
      "name": "The SDR Show",
      "search_name": "The SDR Show",
      "episode_count": 963,
      "live_schedule": "...",
      "thumbnail": "https://app.gdn.streamingmediahosting.com/static/images/<sha>.png",
      "hosts": [{ id, full_name, profile_image }]
    },
    "hosts_compact": "Ralph Sutton,Aaron Berg",
    "playlists": "",
    "episode": 924,
    "duration": 3931,
    "description": "...",
    "category": "regular",
    "tags": [],
    "year": 2026,
    "month": 5,
    "date": 1779854400,
    "thumbnail": "<Kaltura url, width/400>",
    "thumbnail_remote": null,
    "poster": "<Kaltura url, width/0>",
    "playback": "<Kaltura HLS master URL>"
  }
  ```
- **Important field**: `show.search_name` — use this as the value for `/api/search/?shows=<name>`, not `show.name`. They appear to match but a future divergence would silently break pagination.
- `playback` is the HLS master — no DRM, no signing, plays directly.

## Watch progress / history

### `GET /api/user/metrics/`

- **Auth required**.
- Optional `?home=true&history=true` flags (observed in the SPA — both produce the same result on a small account so semantics unclear).
- Optional `?episode=<sqid>` (ignored in current impl — still returns full history).
- DRF paginated `{count, next, previous, results}`. Each entry:
  ```json
  {
    "position":  1526513,        // ms (sub-second precision)
    "timestamp": 1780180599310,  // ms epoch
    "event":     "stalled",      // "play", "pause", "stalled", ...
    "duration":  3817668,        // ms
    "sqid":      "<episodeId>",
    "episode":   { id, name, description, show, duration, episode, date, thumbnail, tags }
  }
  ```

### `POST /api/user/metrics/`

- **Auth required**.
- Body shapes that **work** (verified, all 200):
  ```json
  { "sqid": "<episodeId>", "position": 0, "event": "play" }
  { "sqid": "<episodeId>", "position": 1000, "event": "pause", "duration": 3931000 }
  ```
- Server accepts `episode` as an alias for `sqid`. Empty response body.
- Use this from `getPlaybackTracker(url)` to write watch progress as the user plays.

## Hosts / comments / recommendations

All probed, all **404**:

- `GET /api/hosts/{id}/`
- `GET /api/episodes/{id}/comments/`
- `GET /api/comments/?episode={id}`
- `GET /api/recommendations/`
- `GET /api/recommendations/episodes/`

No comments API. No recommendation API. The Polycentric path (URL-as-topic
comment derivation) remains the only comment channel.

## Rate limiting

Sustained burst behavior (logged-in session, single IP, single browser):

| Target | Pattern | Result |
|---|---|---|
| `GET /api/featured/` | 120 sequential requests | 10.8 s wall, **11.1 req/s, all 200**. No 429. |
| `GET /api/search/?shows=…` | 80 sequential requests | 9.3 s wall, **8.6 req/s, all 200**. No 429. |
| `GET /api/featured/` | 10 parallel requests | All 10 returned 200. |

**No `X-RateLimit-*` / `Retry-After` headers** observed. No 429 surfaced.

For the plugin's actual load profile (≤5 calls per home page, ≤1 call per
scroll), this is multiple orders of magnitude under any practical ceiling. The
existing `SHOWS_PER_PAGE = 4` is more than safe.

## CDN / asset hosts

The plugin's `allowUrls` must cover:

- `gasdigital.com` — API + static (`/static/images/*.png` for show art)
- `.streamingmediahosting.com` — Kaltura: `mediaplatform.streamingmediahosting.com` (thumbnails), `hwvod.streamingmediahosting.com` (HLS variant playlists + TS segments), `app.gdn.streamingmediahosting.com` (some show art surfaced from episode detail)

Current `assets/config.json` covers both (`.gasdigital.com` and
`.streamingmediahosting.com` — dot-prefix matches all subdomains per the
Kotlin `matchesDomain` semantics).

## What's already wired, what's not

| Endpoint | Currently used by plugin | Worth adding? |
|---|---|---|
| `POST /api/login/` | indirectly (webview captures cookies) | — |
| `POST /api/token/refresh/` | yes (proactive + 401 retry) | — |
| `GET /api/user/` | yes (`isSessionActive` probe) | — |
| `GET /api/featured/` | yes (cached) | — |
| `GET /api/shows/{id}/` | yes | — |
| `GET /api/episodes/{id}/` | yes | — |
| `GET /api/search/?shows=…` | yes (paginated via `next`) | — |
| `GET /api/banner/livenow/` | no | If show is live, surface as `Type.Feed.Live` content with `transition` countdown |
| `GET /api/live/` | no | `getHome` could surface `up_next` as a live card |
| `GET /api/schedule/` | no | Could power a "What's airing today" surface; not part of standard Grayjay UI though |
| `GET /api/playlists/` | no | Each playlist could surface as a `PlatformChannel`; `getChannelContents` would route playlist URLs to `/api/search/?playlists=<name>` |
| `GET /api/search/?q=…` | no — we only do show-name search | **Yes — implement free-text `source.search(query)` to query `/api/search/?q=<query>` directly** instead of falling back to substring-matching show names. |
| `GET /api/user/metrics/` | no | `getUserHistory()` could return this paginated |
| `POST /api/user/metrics/` | no | `getPlaybackTracker(url)` → write `{sqid, position, event}` on play/pause/stall |
| Search `filters` block | no | Feed into `getChannelCapabilities` / `getSearchCapabilities` for a richer filter UI |
| `show.episode_categories` | no | Per-show capability for Bonus / Green Room / regular filtering |

## Method/path index (raw)

| Method | Path | Status | Auth |
|---|---|---|---|
| POST | `/api/login/` | 200 | public |
| POST | `/api/logout/` | 200 | yes |
| POST | `/api/token/refresh/` | 200 | refresh cookie |
| POST | `/api/token/blacklist/` | 404 | — |
| GET  | `/api/user/` | 200 / 401 | yes |
| GET  | `/api/user/me/`, `/preferences/`, `/subscriptions/`, `/history/`, `/watchlist/`, `/favorites/`, `/notifications/` | 404 | — |
| GET  | `/api/user/metrics/`, `/api/user/metrics/?home=true&history=true`, `/api/user/metrics/?episode=<id>` | 200 / 401 | yes |
| POST | `/api/user/metrics/` | 200 | yes |
| GET  | `/api/featured/` | 200 | public |
| GET  | `/api/shows/` | 200 | public |
| GET  | `/api/shows/{id}/` | 200 | public |
| GET  | `/api/playlists/` | 200 | public |
| GET  | `/api/playlists/{id}/` | 200 | public |
| GET  | `/api/playlists/{id}/episodes/` | 404 | — |
| GET  | `/api/slideshows/{id}/` | 200 | public |
| GET  | `/api/banner/livenow/` | 200 / 401 | yes |
| GET  | `/api/live/` | 200 / 401 | yes |
| GET  | `/api/schedule/` | 200 | public |
| GET  | `/api/search/?(q\|shows\|playlists\|hosts)=...` | 200 / 401 | yes |
| GET  | `/api/episodes/{id}/` | 200 / 401 | yes |
| GET  | `/api/episodes/` | 404 | — |
| GET  | `/api/categories/`, `/api/tags/`, `/api/hosts/`, `/api/hosts/{id}/` | 404 | — |
| GET  | `/api/recommendations/`, `/api/recommendations/episodes/` | 404 | — |
| GET  | `/api/episodes/{id}/comments/`, `/api/comments/?episode={id}` | 404 | — |

## Methodology

Probe driven via `mcp__MCP_DOCKER__browser_*` tools (Playwright MCP gateway).
Credentials loaded from `.env` (gitignored). All responses parsed in the page
context to keep JWTs out of the agent transcript — strings matching
`/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/` were stripped to `<jwt>`
before being returned. The MCP gateway also has its own secret-leak guard that
refuses to surface the literal access/refresh JWT bodies.
