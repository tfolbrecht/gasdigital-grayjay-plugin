import { defineConfig, type Plugin } from 'vite';
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build as esbuild } from 'esbuild';

const SCRIPT_FILENAME = 'GasDigitalScript.js';
const CONFIG_FILENAME = 'GasDigitalConfig.json';
const ICON_FILENAME = 'GasDigitalIcon.png';
const LANDING_FILENAME = 'index.html';
const OG_CARD_FILENAME = 'og-card.svg';
const THEME_COLOR = '#ff6b35';
const BG_COLOR = '#0b0d12';

const REQUIRED_CONFIG_FIELDS = [
  'name', 'description', 'author', 'authorUrl',
  'sourceUrl', 'repositoryUrl', 'scriptUrl', 'version',
  'id', 'iconUrl', 'scriptSignature', 'scriptPublicKey',
  'packages', 'allowEval', 'allowUrls',
] as const;

/** Read the width/height of a PNG without taking a dependency. */
function pngDimensions(path: string): { width: number; height: number } | null {
  try {
    const buf = readFileSync(path);
    if (buf.length < 24) return null;
    if (buf.readUInt32BE(0) !== 0x89504e47) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/** Compose a 1200x630 OG card SVG with the plugin icon, name, and blurb. */
function ogCardSvg(name: string, blurb: string, iconDataUri: string | null): string {
  // Squeeze the blurb into roughly two lines.
  const words = blurb.split(/\s+/);
  const lines: string[] = ['', ''];
  let idx = 0;
  for (const w of words) {
    if ((lines[idx]!.length + w.length + 1) > 56 && idx === 0) idx = 1;
    if ((lines[idx]!.length + w.length + 1) > 60) break;
    lines[idx] = (lines[idx]! + ' ' + w).trim();
  }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="bg1" cx="20%" cy="0%" r="60%">
      <stop offset="0%" stop-color="${THEME_COLOR}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${THEME_COLOR}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bg2" cx="100%" cy="110%" r="55%">
      <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#60a5fa" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bgbase" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${BG_COLOR}"/>
      <stop offset="100%" stop-color="#14171f"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bgbase)"/>
  <rect width="1200" height="630" fill="url(#bg1)"/>
  <rect width="1200" height="630" fill="url(#bg2)"/>
  <g transform="translate(80,160)">
    ${iconDataUri ? `<image href="${iconDataUri}" x="0" y="0" width="160" height="160" preserveAspectRatio="xMidYMid slice" clip-path="inset(0 round 32)"/>` : ''}
    <g transform="translate(${iconDataUri ? 200 : 0}, 0)" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">
      <text x="0" y="46" fill="${THEME_COLOR}" font-size="22" font-weight="700" letter-spacing="3">GRAYJAY · SOURCE</text>
      <text x="0" y="120" fill="#e8ecf3" font-size="72" font-weight="800" letter-spacing="-1.5">${esc(name)}</text>
      <text x="0" y="195" fill="#8b94a8" font-size="28" font-weight="400">${esc(lines[0]!)}</text>
      <text x="0" y="232" fill="#8b94a8" font-size="28" font-weight="400">${esc(lines[1]!)}</text>
    </g>
  </g>
  <g transform="translate(80, 540)" font-family="ui-monospace, 'SF Mono', Menlo, monospace">
    <text x="0" y="0" fill="${THEME_COLOR}" font-size="20" font-weight="600">tfolbrecht.github.io/gasdigital-grayjay-plugin</text>
  </g>
</svg>
`;
}

async function bundleQrcodeForBrowser(): Promise<string> {
  const result = await esbuild({
    stdin: {
      contents: `import QRCode from 'qrcode'; window.QRCode = QRCode;`,
      resolveDir: process.cwd(),
      loader: 'js',
    },
    bundle: true,
    minify: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2017',
    write: false,
    legalComments: 'none',
  });
  return result.outputFiles[0]!.text;
}

interface LandingFields {
  name: string;
  description: string;
  version: number;
  repositoryUrl: string;
  authorUrl: string;
  author: string;
  platformUrl: string;
  signed: boolean;
  hasIcon: boolean;
  sourceUrl: string;
  iconDims: { width: number; height: number } | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function landingHtml(fields: LandingFields, qrcodeJs: string): string {
  const { name, description, version, repositoryUrl, authorUrl, author, platformUrl, signed, hasIcon, sourceUrl, iconDims } = fields;
  // sourceUrl points at the config JSON; the landing page sits one path level up.
  const siteUrl = (() => {
    try {
      const u = new URL(sourceUrl);
      return new URL('./', u).toString();
    } catch {
      return '';
    }
  })();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(name)} — Grayjay plugin</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="theme-color" content="${THEME_COLOR}" />
  <meta name="color-scheme" content="dark" />
  ${hasIcon ? `<link rel="icon" type="image/png" href="./${ICON_FILENAME}" />` : ''}
  ${hasIcon ? `<link rel="apple-touch-icon" href="./${ICON_FILENAME}" />` : ''}
  ${siteUrl ? `<link rel="canonical" href="${escapeHtml(siteUrl)}" />` : ''}

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Grayjay" />
  <meta property="og:title" content="${escapeHtml(name)} — Grayjay plugin" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  ${siteUrl ? `<meta property="og:url" content="${escapeHtml(siteUrl)}" />` : ''}
  <meta property="og:image" content="./${OG_CARD_FILENAME}" />
  <meta property="og:image:type" content="image/svg+xml" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${escapeHtml(name)} — ${escapeHtml(description)}" />

  <!-- Twitter (prefers PNG; point at the icon as fallback) -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(name)} — Grayjay plugin" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="./${OG_CARD_FILENAME}" />
  ${hasIcon && iconDims ? `<meta name="twitter:image:src" content="./${ICON_FILENAME}" />` : ''}
  <style>
    :root {
      color-scheme: dark;
      --bg-0: #0b0d12;
      --bg-1: #14171f;
      --fg: #e8ecf3;
      --muted: #8b94a8;
      --accent: #ff6b35;
      --accent-fg: #0b0d12;
      --border: #232838;
      --border-strong: #2e3447;
      --panel: rgba(20, 23, 31, 0.55);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background:
        radial-gradient(1200px 800px at 20% -10%, rgba(255,107,53,0.12), transparent 60%),
        radial-gradient(900px 700px at 100% 110%, rgba(96,165,250,0.10), transparent 60%),
        linear-gradient(180deg, var(--bg-0), var(--bg-1));
      background-attachment: fixed;
      color: var(--fg);
      line-height: 1.55;
      min-height: 100vh;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .container { width: 100%; max-width: 960px; margin: 0 auto; padding: 0 24px; }

    /* Top bar */
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 0;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--fg);
      font-weight: 600;
      font-size: 14px;
    }
    .brand:hover { text-decoration: none; }
    .brand img {
      width: 28px;
      height: 28px;
      border-radius: 7px;
      background: rgba(255,255,255,0.04);
      object-fit: cover;
    }
    .topbar nav { display: flex; gap: 18px; font-size: 13px; }
    .topbar nav a { color: var(--muted); }
    .topbar nav a:hover { color: var(--fg); text-decoration: none; }

    /* Hero */
    .hero {
      padding: 64px 0 72px;
      display: grid;
      gap: 24px;
      justify-items: center;
      text-align: center;
    }
    .badges {
      display: inline-flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent);
      background: rgba(255, 107, 53, 0.12);
      border: 1px solid rgba(255, 107, 53, 0.3);
      padding: 4px 10px;
      border-radius: 999px;
    }
    .badge.signed { color: #4ade80; background: rgba(74,222,128,0.10); border-color: rgba(74,222,128,0.3); }
    .badge.unsigned { color: #fbbf24; background: rgba(251,191,36,0.10); border-color: rgba(251,191,36,0.3); }
    .badge.neutral { color: var(--muted); background: rgba(139,148,168,0.08); border-color: var(--border); }
    h1 {
      margin: 0;
      font-size: clamp(36px, 6vw, 56px);
      font-weight: 800;
      letter-spacing: -0.025em;
      line-height: 1.05;
    }
    .tagline {
      margin: 0;
      max-width: 580px;
      color: var(--muted);
      font-size: clamp(15px, 2vw, 18px);
    }
    .cta-row { display: inline-flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 13px 22px;
      border-radius: 12px;
      font-weight: 700;
      font-size: 14.5px;
      border: 1px solid transparent;
      cursor: pointer;
      text-decoration: none;
      transition: transform 0.05s ease, filter 0.15s ease, background 0.15s ease;
    }
    .btn-primary { background: var(--accent); color: var(--accent-fg); }
    .btn-primary:hover { filter: brightness(1.08); text-decoration: none; }
    .btn-primary:active { transform: translateY(1px); }
    .btn-secondary { background: transparent; color: var(--fg); border-color: var(--border-strong); }
    .btn-secondary:hover { background: rgba(255,255,255,0.04); text-decoration: none; }

    /* Sections */
    section { padding: 56px 0; border-top: 1px solid var(--border); }
    .section-head { margin: 0 0 32px; }
    .section-head h2 {
      margin: 0 0 8px;
      font-size: clamp(22px, 3vw, 28px);
      letter-spacing: -0.015em;
    }
    .section-head p { margin: 0; color: var(--muted); max-width: 640px; }

    /* Install grid */
    .install-grid { display: grid; gap: 24px; grid-template-columns: 1fr; }
    @media (min-width: 760px) {
      .install-grid { grid-template-columns: auto 1fr; align-items: start; }
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      backdrop-filter: blur(8px);
    }
    .qr-panel { text-align: center; padding: 20px; }
    .qr { background: #fff; border-radius: 12px; padding: 12px; display: inline-block; }
    .qr-svg { width: 240px; height: 240px; display: block; }
    .qr-caption { margin: 14px 0 0; color: var(--muted); font-size: 13px; }
    .steps { display: grid; gap: 18px; margin: 0; padding: 0; list-style: none; counter-reset: step; }
    .steps li {
      counter-increment: step;
      display: grid;
      grid-template-columns: 28px 1fr;
      gap: 14px;
      align-items: start;
    }
    .steps li::before {
      content: counter(step);
      width: 28px;
      height: 28px;
      border-radius: 999px;
      background: rgba(255, 107, 53, 0.15);
      color: var(--accent);
      font-weight: 700;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .steps strong { display: block; color: var(--fg); margin-bottom: 4px; font-weight: 600; }
    .steps p { margin: 0; color: var(--muted); font-size: 14px; }
    .url {
      display: block;
      margin-top: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12.5px;
      color: var(--fg);
      background: #0a0c12;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      word-break: break-all;
      user-select: all;
    }

    /* About */
    .features { display: grid; gap: 18px; grid-template-columns: 1fr; }
    @media (min-width: 760px) { .features { grid-template-columns: repeat(3, 1fr); } }
    .feature { padding: 20px; }
    .feature h3 { margin: 0 0 8px; font-size: 16px; letter-spacing: -0.005em; }
    .feature p { margin: 0; color: var(--muted); font-size: 14px; }

    /* Meta strip */
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      color: var(--muted);
      font-size: 13px;
      padding-top: 32px;
      margin-top: 36px;
      border-top: 1px solid var(--border);
    }

    /* Footer */
    footer {
      padding: 36px 24px 48px;
      text-align: center;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.7;
      border-top: 1px solid var(--border);
    }
    footer a { color: var(--muted); border-bottom: 1px dotted var(--border); }
    footer a:hover { color: var(--fg); text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <header class="topbar">
      <a class="brand" href="./">
        ${hasIcon ? `<img src="./${ICON_FILENAME}" alt="" />` : ''}
        <span>${escapeHtml(name)}</span>
      </a>
      <nav>
        <a href="#install">Install</a>
        <a href="${escapeHtml(repositoryUrl)}" target="_blank" rel="noopener">Source</a>
      </nav>
    </header>

    <section class="hero" style="border-top:none;">
      <div class="badges">
        <span class="badge">Grayjay source</span>
        <span class="badge ${signed ? 'signed' : 'unsigned'}">${signed ? 'signed' : 'unsigned'}</span>
        <span class="badge neutral">v${version}</span>
      </div>
      <h1>${escapeHtml(name)}</h1>
      <p class="tagline">${escapeHtml(description)}</p>
      <div class="cta-row">
        <a class="btn btn-primary" id="cta" href="#">Open in Grayjay</a>
        <a class="btn btn-secondary" href="#install">How to install</a>
      </div>
    </section>

    <section id="install">
      <div class="section-head">
        <h2>Install</h2>
        <p>Scan the QR with your phone, or paste the source URL into Grayjay.</p>
      </div>
      <div class="install-grid">
        <div class="panel qr-panel">
          <div class="qr" id="qr" aria-label="grayjay:// install deep link"></div>
          <p class="qr-caption">Scan to install on mobile</p>
        </div>
        <ol class="steps panel">
          <li>
            <div>
              <strong>Get Grayjay</strong>
              <p>Download the app at <a href="https://grayjay.app" target="_blank" rel="noopener">grayjay.app</a>.</p>
            </div>
          </li>
          <li>
            <div>
              <strong>Add this source</strong>
              <p>Settings → Sources → Add Source by URL. Paste:</p>
              <code class="url" id="url">computing…</code>
            </div>
          </li>
          <li>
            <div>
              <strong>Sign in once</strong>
              <p>The plugin opens a webview the first time. Log in to ${escapeHtml(platformUrl.replace(/^https?:\/\//, ''))} and you're done.</p>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <section id="about">
      <div class="section-head">
        <h2>What it does</h2>
        <p>A community plugin that lets <a href="https://grayjay.app" target="_blank" rel="noopener">Grayjay</a> stream content from <a href="${escapeHtml(platformUrl)}" target="_blank" rel="noopener">${escapeHtml(platformUrl.replace(/^https?:\/\//, ''))}</a>.</p>
      </div>
      <div class="features">
        <div class="feature panel">
          <h3>Native playback</h3>
          <p>Episodes play through Grayjay's video player, not an embedded web view.</p>
        </div>
        <div class="feature panel">
          <h3>Unified home feed</h3>
          <p>New episodes surface in your Grayjay home feed alongside your other sources.</p>
        </div>
        <div class="feature panel">
          <h3>Polycentric sync</h3>
          <p>Watch history syncs through Polycentric so you can pick up where you left off.</p>
        </div>
      </div>

      <div class="meta">
        <span><a href="./${CONFIG_FILENAME}">config.json</a></span>
        <span><a href="./${SCRIPT_FILENAME}">script.js</a></span>
        <span><a href="${escapeHtml(repositoryUrl)}" target="_blank" rel="noopener">View source on GitHub</a></span>
      </div>
    </section>
  </div>

  <footer>
    Made by <a href="${escapeHtml(authorUrl)}" target="_blank" rel="noopener">${escapeHtml(author)}</a>.
    Written with love for my friend Misha.<br/>
    Not affiliated with FUTO, Grayjay, or Gas Digital Network.
  </footer>
  <script>${qrcodeJs}</script>
  <script>
    (function () {
      var configUrl = new URL('./${CONFIG_FILENAME}', window.location.href).toString();
      var deepLink = 'grayjay://plugin/' + configUrl;
      document.getElementById('url').textContent = configUrl;
      document.getElementById('cta').href = deepLink;
      window.QRCode.toString(deepLink, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#0b0d12', light: '#ffffff' }
      }, function (err, svg) {
        if (err) { document.getElementById('qr').textContent = String(err); return; }
        var el = document.getElementById('qr');
        el.innerHTML = svg;
        var svgEl = el.querySelector('svg');
        if (svgEl) svgEl.classList.add('qr-svg');
      });
    })();
  </script>
</body>
</html>
`;
}

function pluginConfigEmitter(): Plugin {
  return {
    name: 'gasdigital-plugin-config',
    apply: 'build',
    async closeBundle() {
      const root = process.cwd();
      const configSrc = resolve(root, 'assets/config.json');
      const iconSrc = resolve(root, 'assets/icon.png');
      const outDir = resolve(root, 'dist');

      mkdirSync(outDir, { recursive: true });
      const raw = readFileSync(configSrc, 'utf8');
      const config = JSON.parse(raw) as Record<string, unknown>;

      const missing = REQUIRED_CONFIG_FIELDS.filter((k) => !(k in config));
      if (missing.length) {
        throw new Error(`config.json missing required fields: ${missing.join(', ')}`);
      }
      if (typeof config.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(config.id)) {
        throw new Error(`config.json "id" must be a UUID, got: ${String(config.id)}`);
      }
      if (typeof config.version !== 'number' || !Number.isInteger(config.version)) {
        throw new Error(`config.json "version" must be an integer`);
      }
      if (!Array.isArray(config.packages)) {
        throw new Error(`config.json "packages" must be an array`);
      }
      if (!Array.isArray(config.allowUrls)) {
        throw new Error(`config.json "allowUrls" must be an array`);
      }

      config.scriptUrl = `./${SCRIPT_FILENAME}`;
      config.iconUrl = `./${ICON_FILENAME}`;

      writeFileSync(resolve(outDir, CONFIG_FILENAME), JSON.stringify(config, null, 2) + '\n');

      if (existsSync(iconSrc)) {
        copyFileSync(iconSrc, resolve(outDir, ICON_FILENAME));
      } else {
        this.warn(`icon not found at ${iconSrc} — dist will not include ${ICON_FILENAME}`);
      }

      const qrcodeJs = await bundleQrcodeForBrowser();
      const hasIcon = existsSync(iconSrc);
      const iconDims = hasIcon ? pngDimensions(iconSrc) : null;
      const iconDataUri = hasIcon
        ? `data:image/png;base64,${readFileSync(iconSrc).toString('base64')}`
        : null;
      writeFileSync(
        resolve(outDir, OG_CARD_FILENAME),
        ogCardSvg(String(config.name ?? 'Plugin'), String(config.description ?? ''), iconDataUri),
      );
      writeFileSync(
        resolve(outDir, LANDING_FILENAME),
        landingHtml(
          {
            name: String(config.name ?? 'Plugin'),
            description: String(config.description ?? ''),
            version: (config.version as number) ?? 0,
            repositoryUrl: String(config.repositoryUrl ?? ''),
            authorUrl: String(config.authorUrl ?? ''),
            author: String(config.author ?? ''),
            platformUrl: String(config.platformUrl ?? 'https://gasdigital.com'),
            signed: Boolean(config.scriptSignature) && Boolean(config.scriptPublicKey),
            hasIcon,
            sourceUrl: String(config.sourceUrl ?? ''),
            iconDims,
          },
          qrcodeJs,
        ),
      );
    },
  };
}

export default defineConfig({
  build: {
    target: 'es2017',
    minify: false,
    emptyOutDir: true,
    outDir: 'dist',
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['iife'],
      name: '__GasDigitalPlugin',
      fileName: () => SCRIPT_FILENAME,
    },
    rollupOptions: {
      treeshake: { moduleSideEffects: true },
      output: {
        extend: true,
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
  },
  plugins: [pluginConfigEmitter()],
});
