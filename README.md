# Gas Digital — Grayjay plugin

A Grayjay video plugin for [gasdigital.com](https://gasdigital.com).

## Layout

```
src/                 TypeScript source
  index.ts             entry — wires source.* methods
  api.ts               HTTP client wrappers
  mappers.ts           API JSON -> Grayjay platform types
  pagers.ts            VideoPager subclasses
  types/
    grayjay.d.ts       ambient declarations for the plugin runtime
    gasdigital.ts      typed shapes for gasdigital.com responses
assets/
  config.json          plugin manifest (templated by the build)
  icon.png             plugin icon (drop your own here)
dist/                  build output — what Grayjay loads
  GasDigitalScript.js
  GasDigitalConfig.json
  GasDigitalIcon.png
scripts/
  validate-dist.mjs    post-build sanity check
```

## Build

```
npm install
npm run keygen         # one-time: RSA-2048 keypair into .keys/ (gitignored)
npm run build          # bundle -> sign -> validate
npm run typecheck      # tsc --noEmit
npm run validate       # asserts dist/ is well-formed and signature verifies
npm run sign           # re-sign without rebuilding
npm run watch          # rebuild on change
npm run clean          # rm -rf dist
```

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
`http://192.168.1.107:8080/`). The local dev server rewrites the static
config's `sourceUrl` / `scriptUrl` / `iconUrl` to absolute LAN URLs per
request — so the same `dist/` works for both GitHub Pages and local serve.

## Auth

`assets/config.json` declares an `authentication` block that opens
`https://gasdigital.com/account/sign-in` in a webview and captures the
`cookie` + `user-agent` headers. Calls in `api.ts` that need a session pass
`useAuth=true` to `http.GET`, which makes Grayjay attach the captured headers.

Streaming itself does not require auth — the `/api/episodes/{id}/` response
returns a public Kaltura HLS master URL. Auth is only used for subscriber-gated
content and watch history.

## Reference

Plugin runtime types are mirrored in `src/types/grayjay.d.ts` from the FUTO
sample at `gasdigital/plugin.d.ts` (the cloned upstream sample, which is the
canonical reference for the host API). Upstream plugins live at
[gitlab.futo.org/videostreaming/plugins](https://gitlab.futo.org/videostreaming/plugins).
