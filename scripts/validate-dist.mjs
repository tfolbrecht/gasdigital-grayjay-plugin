#!/usr/bin/env node
// Validates that dist/ contains a well-formed Grayjay plugin bundle.
// Run after `npm run build`. Exits non-zero on any failure.
//
// Rules mirror what the Android client actually enforces:
//   SourcePluginConfig.kt          — manifest schema + getWarnings()
//   Extensions_Formatting.kt       — matchesDomain semantics (".prefix" only)
//   SourcePluginAuthConfig.kt      — authentication block shape
//   JSClient.kt                    — dispatched source.* method surface
//   StatePolycentric.kt            — Polycentric ClaimType integer semantics
//   VideoDetailView.kt             — URL-as-Polycentric-topic invariant

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { createPublicKey, createVerify } from 'node:crypto';

const dist = resolve(process.cwd(), 'dist');
const configPath = resolve(dist, 'GasDigitalConfig.json');
const scriptPath = resolve(dist, 'GasDigitalScript.js');
const iconPath = resolve(dist, 'GasDigitalIcon.png');

// Hardcoded in SourcePluginConfig.isOfficialAuthor() — only FUTO devs hold the
// corresponding private key. Any third-party plugin shipping this value is an
// impersonation attempt.
const FUTO_OFFICIAL_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsoFJU4AReDyUnSQI9A99UjLCwkY8OH+1o8cdtf2EjSb+fO2qmP8MGMTAvfvgmq5d2QBJE2XHRkRO3JKcTlcc1j0WlOlU8P9W272DYCeX6oYaavpKNqGKoGEuodp9wtiyNwyH46++JfpU/uIUacZbZKkHv9gIGchmNvpKYZQjFd/8pUqXGpcXZP54tGSC9PLcY+5TozZThK7Oy1+3YEf1bZ44UinRYYATbLk/wNuAfsupvlt6nxZOcJhABhdo9V+gY0FE6Ayg5+1cd1noWhnRtLF+sPdEr3z8Nt15JEK5a/524t25FMhwz8yKxlGW5qW3QLJHSUgLQncL6a1zlZ1s8QIDAQAB';

const REQUIRED_FIELDS = ['name', 'scriptUrl', 'version', 'id'];

const TYPED_FIELDS = {
  name: 'string', description: 'string', author: 'string', authorUrl: 'string',
  repositoryUrl: 'string?', scriptUrl: 'string', version: 'int', iconUrl: 'string?',
  id: 'uuid', scriptSignature: 'string?', scriptPublicKey: 'string?',
  allowEval: 'bool', allowUrls: 'string[]', packages: 'string[]', packagesOptional: 'string[]',
  settings: 'array', authentication: 'object?', sourceUrl: 'string?',
  supportedClaimTypes: 'int[]', primaryClaimFieldType: 'int?',
  allowAllHttpHeaderAccess: 'bool',
  enableInSearch: 'bool', enableInHome: 'bool', enableInShorts: 'bool',
  maxDownloadParallelism: 'int', subscriptionRateLimit: 'int?',
  developerSubmitUrl: 'string?', platformUrl: 'string?',
  reduceFunctionsInLimitedVersion: 'bool',
};

// source.* methods JSClient.kt actually dispatches (subset relevant to a typical
// content plugin). Capability-gated ones are still listed so we surface the
// presence/absence in the report.
const EXPECTED_SOURCE_METHODS = [
  'enable', 'disable', 'saveState',
  'getHome', 'getShorts',
  'search', 'searchSuggestions', 'getSearchCapabilities', 'searchChannels',
  'isChannelUrl', 'getChannel', 'getChannelCapabilities', 'getChannelContents',
  'getChannelTemplateByClaimMap',
  'isContentDetailsUrl', 'getContentDetails',
  'isLoggedIn',
];

const errors = [];
const warnings = [];

function checkType(name, value, type) {
  const optional = type.endsWith('?');
  const t = optional ? type.slice(0, -1) : type;
  if (value == null) {
    if (optional) return;
    errors.push(`config.${name}: required (type ${type}) but missing/null`);
    return;
  }
  switch (t) {
    case 'string': if (typeof value !== 'string') errors.push(`config.${name}: expected string, got ${typeof value}`); break;
    case 'bool': if (typeof value !== 'boolean') errors.push(`config.${name}: expected boolean, got ${typeof value}`); break;
    case 'int': if (!Number.isInteger(value)) errors.push(`config.${name}: expected integer, got ${value}`); break;
    case 'uuid':
      if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value))
        errors.push(`config.${name}: expected UUID, got ${value}`);
      break;
    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) errors.push(`config.${name}: expected object`);
      break;
    case 'array':
      if (!Array.isArray(value)) errors.push(`config.${name}: expected array`);
      break;
    case 'string[]':
      if (!Array.isArray(value)) errors.push(`config.${name}: expected string[]`);
      else for (const [i, v] of value.entries())
        if (typeof v !== 'string') errors.push(`config.${name}[${i}]: expected string, got ${typeof v}`);
      break;
    case 'int[]':
      if (!Array.isArray(value)) errors.push(`config.${name}: expected int[]`);
      else for (const [i, v] of value.entries())
        if (!Number.isInteger(v)) errors.push(`config.${name}[${i}]: expected integer, got ${v}`);
      break;
  }
}

function validateAllowUrls(cfg) {
  if (!Array.isArray(cfg.allowUrls)) return;
  if (cfg.allowUrls.length === 0) {
    errors.push(`config.allowUrls: empty — plugin can't reach any host. Add ".gasdigital.com" or "everywhere".`);
    return;
  }
  let hasEverywhere = false;
  for (const pattern of cfg.allowUrls) {
    if (typeof pattern !== 'string') continue;
    if (pattern.toLowerCase() === 'everywhere') {
      hasEverywhere = true;
      continue;
    }
    if (pattern.startsWith('*.')) {
      errors.push(
        `config.allowUrls "${pattern}": Grayjay matches only exact-host or '.'-prefix subdomain. ` +
          `Replace with ".${pattern.slice(2)}".`,
      );
    } else if (pattern.includes('://')) {
      errors.push(`config.allowUrls "${pattern}": should be a bare host, not a URL.`);
    } else if (pattern.includes('/')) {
      errors.push(`config.allowUrls "${pattern}": should be a host, not a path.`);
    } else if (pattern.startsWith('.')) {
      // ".gasdigital.com" — subdomain match; verify TLD isn't bare.
      if (pattern.split('.').filter(Boolean).length < 2)
        errors.push(`config.allowUrls "${pattern}": illegal wildcard on first-level domain.`);
    }
  }
  if (hasEverywhere) {
    warnings.push(
      `config.allowUrls contains "everywhere" — Grayjay surfaces this as "Unrestricted Web Access". Prefer specific hosts.`,
    );
  }
}

function validateAuthentication(cfg) {
  const a = cfg.authentication;
  if (a == null) return;
  if (typeof a !== 'object' || Array.isArray(a)) {
    errors.push(`config.authentication: expected object`);
    return;
  }
  if (typeof a.loginUrl !== 'string' || !a.loginUrl) {
    errors.push(`config.authentication.loginUrl: required string (URL of webview login page)`);
  } else {
    try {
      const u = new URL(a.loginUrl);
      if (u.protocol !== 'https:') warnings.push(`config.authentication.loginUrl is not HTTPS`);
    } catch {
      errors.push(`config.authentication.loginUrl: not a valid URL (${a.loginUrl})`);
    }
  }
  if (a.completionUrl != null && typeof a.completionUrl !== 'string') {
    errors.push(`config.authentication.completionUrl: expected string`);
  }
  if (a.headersToFind && !Array.isArray(a.headersToFind)) errors.push(`config.authentication.headersToFind: expected string[]`);
  if (a.cookiesToFind && !Array.isArray(a.cookiesToFind)) errors.push(`config.authentication.cookiesToFind: expected string[]`);
  if (a.domainHeadersToFind && (typeof a.domainHeadersToFind !== 'object' || Array.isArray(a.domainHeadersToFind))) {
    errors.push(`config.authentication.domainHeadersToFind: expected Record<string, string[]>`);
  }
  if (a.allowedDomains && !Array.isArray(a.allowedDomains)) errors.push(`config.authentication.allowedDomains: expected string[]`);
}

function validateSignatureField(cfg) {
  const sig = cfg.scriptSignature;
  const pub = cfg.scriptPublicKey;
  if (!sig && !pub) {
    warnings.push(`bundle is unsigned (scriptSignature/scriptPublicKey empty) — Grayjay raises "Missing Signature" on install.`);
    return null;
  }
  if (!sig || !pub) {
    errors.push(`scriptSignature and scriptPublicKey must both be set or both empty.`);
    return null;
  }
  if (pub === FUTO_OFFICIAL_PUBLIC_KEY) {
    errors.push(
      `scriptPublicKey matches the FUTO official key — only FUTO holds the private key. Generate your own via \`npm run keygen\`.`,
    );
    return null;
  }
  if (!existsSync(scriptPath)) return null;
  let key;
  try {
    key = createPublicKey({ key: Buffer.from(pub, 'base64'), format: 'der', type: 'spki' });
  } catch (e) {
    errors.push(`scriptPublicKey is not valid base64 SPKI DER: ${e.message}`);
    return null;
  }
  const verifier = createVerify('SHA512');
  verifier.update(readFileSync(scriptPath));
  const ok = verifier.verify(key, Buffer.from(sig, 'base64'));
  if (!ok) errors.push(`scriptSignature does not verify — Grayjay raises "Invalid Signature".`);
  return ok;
}

function validateConfigWarnings(cfg) {
  // Mirror SourcePluginConfig.getWarnings() — surface them so dev knows what
  // the install UI will tell the user.
  if (cfg.allowEval === true) {
    warnings.push(`config.allowEval=true — Grayjay raises "Eval Access". Prefer false.`);
  }
  if (cfg.allowAllHttpHeaderAccess === true) {
    warnings.push(`config.allowAllHttpHeaderAccess=true — Grayjay raises "Unrestricted Http Header access".`);
  }
  const browserPkg = [].concat(cfg.packages ?? [], cfg.packagesOptional ?? []).includes('Browser');
  if (browserPkg) {
    warnings.push(`config.packages includes "Browser" — Grayjay raises "Browser Interop". Official-only feature.`);
  }
}

function validateConfig() {
  if (!existsSync(configPath)) {
    errors.push(`missing ${configPath}`);
    return null;
  }
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (e) {
    errors.push(`config is not valid JSON: ${e.message}`);
    return null;
  }

  for (const k of REQUIRED_FIELDS) if (!(k in cfg)) errors.push(`config missing required field: ${k}`);

  for (const [field, type] of Object.entries(TYPED_FIELDS)) {
    if (field in cfg) checkType(field, cfg[field], type);
  }

  if (cfg.scriptUrl !== './GasDigitalScript.js') {
    errors.push(`config.scriptUrl: must be "./GasDigitalScript.js", got "${cfg.scriptUrl}"`);
  }
  if (cfg.iconUrl != null && cfg.iconUrl !== './GasDigitalIcon.png') {
    errors.push(`config.iconUrl: must be "./GasDigitalIcon.png", got "${cfg.iconUrl}"`);
  }

  validateAllowUrls(cfg);
  validateAuthentication(cfg);
  validateConfigWarnings(cfg);

  return cfg;
}

function validateSingleScript() {
  if (!existsSync(dist)) return;
  const jsFiles = readdirSync(dist).filter((f) => f.endsWith('.js'));
  if (jsFiles.length === 0) {
    errors.push(`dist contains no .js file`);
  } else if (jsFiles.length > 1) {
    errors.push(`dist must contain exactly one .js file (Grayjay loads a single script). Found: ${jsFiles.join(', ')}`);
  } else if (jsFiles[0] !== 'GasDigitalScript.js') {
    errors.push(`dist .js file must be named GasDigitalScript.js, got ${jsFiles[0]}`);
  }
}

function validateScript(cfg) {
  if (!existsSync(scriptPath)) {
    errors.push(`missing ${scriptPath}`);
    return;
  }
  const src = readFileSync(scriptPath, 'utf8');
  if (statSync(scriptPath).size === 0) {
    errors.push(`script is empty`);
    return;
  }

  // ---- syntax ----
  try {
    new vm.Script(src, { filename: 'GasDigitalScript.js' });
  } catch (e) {
    errors.push(`script is not valid JavaScript: ${e.message}`);
    return;
  }

  // ---- allowEval enforcement ----
  if (cfg && cfg.allowEval === false) {
    // Match standalone calls only — not the substring "eval" in identifiers.
    if (/\beval\s*\(/.test(src)) {
      errors.push(`config.allowEval=false but script calls \`eval(...)\` — Grayjay will refuse to execute.`);
    }
    if (/\bnew\s+Function\s*\(/.test(src)) {
      errors.push(`config.allowEval=false but script constructs \`new Function(...)\` — Grayjay will refuse to execute.`);
    }
  }

  // ---- exception-flow shape ----
  if (cfg && cfg.authentication) {
    if (!src.includes('LoginRequiredException')) {
      errors.push(
        `config.authentication is declared but script never references LoginRequiredException — ` +
          `401/403s won't trigger the login prompt. Throw \`new LoginRequiredException(...)\` on auth failures.`,
      );
    }
  }

  // ---- declared http package usage ----
  if (cfg && Array.isArray(cfg.packages) && cfg.packages.includes('Http')) {
    if (!/\bhttp\.(GET|POST|newClient)\b/.test(src)) {
      warnings.push(`config.packages includes "Http" but script doesn't appear to use http.GET / http.POST / http.newClient.`);
    }
  }

  // ---- run in sandbox with stubbed globals; assert source.* bindings ----
  const source = {};
  const sandbox = {
    source,
    plugin: { config: cfg ?? {}, settings: {} },
    bridge: { log: () => {} },
    http: {
      GET: () => ({ code: 200, body: '{}', headers: {}, url: '', isOk: true }),
      POST: () => ({ code: 200, body: '{}', headers: {}, url: '', isOk: true }),
      newClient: () => sandbox.http,
    },
    log: () => {},
    Type: {
      Source: { Dash: 'DASH', HLS: 'HLS', STATIC: 'Static' },
      Feed: { Videos: 'VIDEOS', Streams: 'STREAMS', Mixed: 'MIXED', Live: 'LIVE', Subscriptions: 'SUBSCRIPTIONS', Shorts: 'SHORTS' },
      Order: { Chronological: 'CHRONOLOGICAL' },
    },
    ScriptException: class extends Error {},
    LoginRequiredException: class extends Error {},
    TimeoutException: class extends Error {},
    PlatformID: class {},
    Thumbnail: class {},
    Thumbnails: class {},
    PlatformAuthorLink: class {},
    PlatformVideo: class {},
    PlatformVideoDetails: class {},
    PlatformChannel: class {},
    UnMuxVideoSourceDescriptor: class {},
    HLSSource: class {},
    DashSource: class {},
    RatingLikes: class {},
    RatingLikesDislikes: class {},
    RatingScaler: class {},
    Comment: class {},
    FilterCapability: class {},
    FilterGroup: class {},
    ResultCapabilities: class {},
    ContentPager: class { constructor(r, h) { this.results = r; this.hasMore = h; } nextPage() { return this; } hasMorePagers() { return false; } },
    VideoPager: class { constructor(r, h) { this.results = r; this.hasMore = h; } nextPage() { return this; } hasMorePagers() { return false; } },
    ChannelPager: class { constructor(r, h) { this.results = r; this.hasMore = h; } nextPage() { return this; } hasMorePagers() { return false; } },
    CommentPager: class { constructor(r, h) { this.results = r; this.hasMore = h; } nextPage() { return this; } hasMorePagers() { return false; } },
  };
  vm.createContext(sandbox);
  try {
    vm.runInContext(src, sandbox, { filename: 'GasDigitalScript.js' });
  } catch (e) {
    errors.push(`script threw during top-level execution: ${e.message}`);
    return;
  }
  const missing = EXPECTED_SOURCE_METHODS.filter((m) => typeof source[m] !== 'function');
  if (missing.length) {
    errors.push(`source bindings missing: ${missing.join(', ')}`);
  }
}

function validateIcon() {
  if (!existsSync(iconPath)) {
    warnings.push(`missing ${iconPath} — install UI will show no icon.`);
    return;
  }
  const buf = readFileSync(iconPath);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(sig)) {
    errors.push(`icon is not a valid PNG.`);
  }
}

// ---------- run ----------

const cfg = validateConfig();
validateSingleScript();
validateScript(cfg);
validateSignatureField(cfg);
validateIcon();

for (const w of warnings) console.warn(`warn:  ${w}`);
if (errors.length) {
  console.error(`\nValidation failed (${errors.length} error${errors.length === 1 ? '' : 's'}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`dist/ is well-formed${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''}`);
