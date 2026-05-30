# Gas Digital — Grayjay plugin

A Grayjay video plugin for [gasdigital.com](https://gasdigital.com).

## Layout

```
src/                 TypeScript source
  index.ts             entry — wires source.* methods
  api.ts               HTTP client wrappers + auth state + session probe
  mappers.ts           API JSON -> Grayjay platform types (canonical URLs)
  pagers.ts            VideoPager subclasses
  polycentric.ts       Polycentric runtime helpers (claim-type constants)
  types/
    grayjay.d.ts       ambient declarations for the plugin runtime
    gasdigital.ts      typed shapes for gasdigital.com responses
    polycentric.d.ts   Polycentric type-only surface
assets/
  config.json          plugin manifest (Vite templates URLs into it)
  icon.png             plugin icon
dist/                  build output — what Grayjay loads
  GasDigitalScript.js  signed IIFE bundle
  GasDigitalConfig.json
  GasDigitalIcon.png
  index.html           install landing (QR + Open in Grayjay)
  og-card.svg          1200x630 OG preview for link unfurls
scripts/
  keygen.mjs           one-time RSA-2048 keypair generation
  sign.mjs             signs the bundle and patches landing badge state
  validate-dist.mjs    schema + signature + sandbox source.* binding checks
  serve.mjs            local dev server (rewrites config + html to "Dev GaS Digital")
```

## Build

```
npm install
npm run keygen         # one-time: RSA-2048 keypair into .keys/ (gitignored)
npm run build          # bundle -> sign -> validate
npm run typecheck      # tsc --noEmit
npm run validate       # asserts dist/ is well-formed and signature verifies
npm run sign           # re-sign without rebuilding
npm run test           # vitest run (unit + integration suite)
npm run test:watch     # vitest --watch
npm run watch          # rebuild on change
npm run clean          # rm -rf dist
```

## Testing

`vitest` + a fixture file (`tests/setup.ts`) that installs the Grayjay runtime
globals (`PlatformID`, `Thumbnails`, `LoginRequiredException`, `Type`, `http`,
…) onto `globalThis` before each test. Three suites cover the three layers:

| File | Layer | What it pins down |
|---|---|---|
| `tests/mappers.test.ts` | Pure helpers | URL canonicalization (`/show/<id>`, `/view/video/<id>`), Kaltura thumbnail resize, `platform_links` → `PlatformChannel.links`, HLS wrapped in `VideoSourceDescriptor` (not `UnMux`), `shareUrl == url` (Polycentric topic invariant) |
| `tests/api.test.ts` | Auth + HTTP state machine | `assertLoggedIn` throw/no-throw, 60s session-check cache (positive AND negative), proactive + reactive refresh on 401, body-excerpt in `ScriptException`, `LoginRequiredException` on 401/403, `getFeatured`/`getShow` caching |
| `tests/index.test.ts` | `source.*` dispatch | URL regex matching (`isChannelUrl`/`isContentDetailsUrl` incl. `www.` and trailing path), `searchSuggestions` cache, fail-fast `LoginRequiredException` ahead of episode fetch, lifecycle (`saveState`/`disable`/`getShorts`/`getChannelTemplateByClaimMap`) |

Each test re-imports the source modules via `vi.resetModules()` so module-level
state (`accessExpiresAt`, `featuredCache`, `showCache`, the show-id map) starts
clean. The mocked `http` accepts both single responses and arrays-as-queues:

```ts
mockHttp({
  'GET https://gasdigital.com/api/user/':           { code: 200, body: '{}' },
  'POST https://gasdigital.com/api/token/refresh/': [
    { code: 401, body: '' },  // first call
    { code: 200, body: JSON.stringify({ access_expiration: '…' }) }, // retry
  ],
});
```

Unmocked calls return `404 {"error":"not mocked", ...}` so missing fixtures
fail loudly through the same `ScriptException` path the real plugin would.

### Why not test against real gasdigital.com?

Type drift between this repo's response interfaces and the live API is exactly
what the **headed Playwright MCP probe** at `docs/api-shapes.md` is for —
re-run that whenever the gasdigital backend changes and diff the report.

### Live credentials for the MCP probe (`.env`)

The probe script in this repo (`scripts/probe-api.mjs` history; now driven via
the Docker Playwright MCP) reads credentials from `.env` in the project root:

```ini
# .env — gitignored. Used only by the live MCP probe, not by the test suite.
username=you@example.com
password=********
```

`.env` is in `.gitignore` and is **never** required to run `npm run test`. The
test suite is fully hermetic.

## Signing

Grayjay verifies the script before running it. The build pipeline:

1. **`keygen`** (run once) — generates `.keys/private.pem` (PKCS8, mode 0600)
   and `.keys/public.pem` (SPKI). Re-running refuses to overwrite unless you
   pass `--force`; rotating the key invalidates every installed copy.
2. **`build`** — bundles, then signs `dist/GasDigitalScript.js` with
   RSASSA-PKCS1-v1_5 + SHA-512, writes the base64 signature into
   `scriptSignature`, and the base64 SPKI DER public key into
   `scriptPublicKey`. If `.keys/private.pem` is missing the bundle ships
   unsigned and the validator emits a warning.

The validator re-verifies the signature against the script + public key, so
any post-build tampering fails CI.

### CI signing (GitHub Actions)

Add the PEM contents of `.keys/private.pem` as a repository secret named
`PLUGIN_PRIVATE_KEY`:

```
gh secret set PLUGIN_PRIVATE_KEY < .keys/private.pem
```

The workflow materializes it to `.keys/private.pem` before `npm run build` and
removes it after. Without the secret, the Pages-deployed bundle is unsigned
and Grayjay surfaces a "Missing Signature" warning on install.

The Vite build does three things:

1. Bundles `src/index.ts` to a single IIFE script (`GasDigitalScript.js`) that
   assigns to the global `source` object that Grayjay provides.
2. Reads `assets/config.json`, validates required Grayjay manifest fields,
   rewrites `scriptUrl` / `iconUrl` to the dist filenames, and writes
   `GasDigitalConfig.json`.
3. Copies `assets/icon.png` to `dist/GasDigitalIcon.png` (warns if missing).

## Loading in Grayjay

### Production (GitHub Pages)

After a push to `main` the workflow at `.github/workflows/pages.yml` builds,
signs (if `PLUGIN_PRIVATE_KEY` is set), and deploys `dist/` to GitHub Pages.
Install URL on the phone:

```
https://tfolbrecht.github.io/gasdigital-grayjay-plugin/GasDigitalConfig.json
```

Open `https://tfolbrecht.github.io/gasdigital-grayjay-plugin/` in a browser to
get the install QR + "Open in Grayjay" deep-link.

### Local dev (sideload over LAN)

For mobile testing on the same Wi-Fi as this machine:

```
npm run build
npm run serve      # binds 0.0.0.0:8080 from dist/
```

Then on the phone, scan the QR at `http://<your-lan-ip>:8080/` (e.g.
`http://192.168.1.107:8080/`). The dev install appears in Grayjay as
**Dev GaS Digital** with a distinct UUID, so it coexists with the prod
install without overwriting it. The dev server rewrites the static config's
`sourceUrl` / `scriptUrl` / `iconUrl` to absolute LAN URLs per
request — so the same `dist/` works for both GitHub Pages and local serve.

## Auth

`assets/config.json` declares an `authentication` block that opens
`https://gasdigital.com/login` in a webview and captures the `gdn-jwt`
(access) + `gdn-jwtr` (refresh) cookies. Calls in `api.ts` that need a
session pass `useAuth=true` to `http.GET`, which makes Grayjay attach the
captured cookies. The refresh path (`POST /api/token/refresh/`) writes a new
`gdn-jwt` `Set-Cookie` that the bridge's cookie jar persists transparently.

Almost everything beyond `/api/featured/` + `/api/shows/[/{id}/]` requires
auth — including the episode-list endpoint (`/api/search/?shows=…`) and
content detail (`/api/episodes/{id}/`). See `docs/api-shapes.md` for the
full matrix.

### Marking the plugin as auth-required

**There is no explicit `requiresLogin: true` flag** in
[`SourcePluginConfig.kt`](https://gitlab.futo.org/videostreaming/grayjay/-/blob/master/app/src/main/java/com/futo/platformplayer/api/media/platforms/js/SourcePluginConfig.kt).
The host treats a plugin as requiring auth implicitly by combining two signals:

1. The presence of an `authentication` block in `Config.json` makes the plugin
   *capable* of login (without it the "Login" button doesn't appear).
2. **Throwing `LoginRequiredException` from any `source.*` call** makes Grayjay
   open the login webview and (per `StatePlugins.loginPlugin` →
   `StatePlatform.reloadClient`) reload the JS context with the new cookies
   wired into `JSHttpClient`.

This plugin does both: the `authentication` block is configured, and every
auth-gated method (`getHome`, `search`, `getChannelContents`,
`getContentDetails`) calls `assertLoggedIn()` up front. So unauthed users get
an immediate "Sign In" prompt — there's no UX path where an empty home or
broken episode looks like a plugin bug instead of a login state.

## Reference

Plugin runtime types are mirrored in `src/types/grayjay.d.ts` from the FUTO
sample at `gasdigital/plugin.d.ts` (the cloned upstream sample, which is the
canonical reference for the host API). Upstream plugins live at
[gitlab.futo.org/videostreaming/plugins](https://gitlab.futo.org/videostreaming/plugins).
