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
      --border: #232838;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background:
        radial-gradient(1200px 800px at 20% -10%, rgba(255,107,53,0.12), transparent 60%),
        radial-gradient(900px 700px at 100% 110%, rgba(96,165,250,0.10), transparent 60%),
        linear-gradient(180deg, var(--bg-0), var(--bg-1));
      color: var(--fg);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      gap: 8px;
    }
    main {
      width: 100%;
      max-width: 480px;
      background: rgba(20, 23, 31, 0.7);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 32px;
      box-shadow: 0 24px 80px rgba(0,0,0,0.5);
      backdrop-filter: blur(8px);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
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
    h1 {
      margin: 12px 0 6px;
      font-size: 28px;
      letter-spacing: -0.02em;
    }
    p.lead {
      margin: 0 0 24px;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.5;
    }
    .qr {
      background: #fff;
      border-radius: 14px;
      padding: 14px;
      display: grid;
      place-items: center;
      margin: 0 auto 20px;
      width: fit-content;
    }
    .qr-svg { width: 280px; height: 280px; display: block; }
    .url {
      display: block;
      width: 100%;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12.5px;
      color: var(--fg);
      background: #0a0c12;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 14px;
      word-break: break-all;
      text-align: center;
      user-select: all;
    }
    .cta {
      display: block;
      text-align: center;
      background: var(--accent);
      color: #0b0d12;
      font-weight: 700;
      letter-spacing: 0.02em;
      padding: 14px 18px;
      border-radius: 12px;
      margin: 0 0 16px;
      text-decoration: none;
      transition: transform 0.05s ease, filter 0.15s ease;
    }
    .cta:hover { filter: brightness(1.08); text-decoration: none; }
    .cta:active { transform: translateY(1px); }
    .fallback {
      margin: 0 0 16px;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 14px;
      color: var(--muted);
      font-size: 13px;
    }
    .fallback summary {
      cursor: pointer;
      user-select: none;
    }
    .fallback p { margin: 10px 0 8px; }
    .meta {
      margin-top: 18px;
      display: flex;
      justify-content: space-between;
      color: var(--muted);
      font-size: 12px;
    }
    .meta code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--fg);
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .hero {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 16px;
    }
    .hero img {
      width: 56px;
      height: 56px;
      border-radius: 14px;
      flex-shrink: 0;
      background: rgba(255,255,255,0.04);
      object-fit: cover;
    }
    .hero h1 { margin: 0; line-height: 1.15; }
    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 14px;
    }
    .badge.signed {
      color: #4ade80;
      background: rgba(74, 222, 128, 0.10);
      border-color: rgba(74, 222, 128, 0.3);
    }
    .badge.unsigned {
      color: #fbbf24;
      background: rgba(251, 191, 36, 0.10);
      border-color: rgba(251, 191, 36, 0.3);
    }
    .blurb {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.55;
      margin: 0 0 20px;
    }
    .explainer {
      margin: 20px 0 12px;
      padding: 12px 14px;
      background: rgba(255,255,255,0.02);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--muted);
      font-size: 12.5px;
      line-height: 1.55;
    }
    .explainer strong { color: var(--fg); }
    footer {
      width: 100%;
      max-width: 480px;
      margin-top: 18px;
      text-align: center;
      color: var(--muted);
      font-size: 12px;
    }
    footer a { color: var(--muted); border-bottom: 1px dotted var(--border); }
    footer a:hover { color: var(--fg); text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <div class="hero">
      ${hasIcon ? `<img src="./${ICON_FILENAME}" alt="${escapeHtml(name)}" />` : ''}
      <div>
        <h1>${escapeHtml(name)}</h1>
        <div class="badges">
          <span class="badge">Grayjay source</span>
          <span class="badge ${signed ? 'signed' : 'unsigned'}">${signed ? 'signed' : 'unsigned'}</span>
          <span class="badge" style="color: var(--muted); background: rgba(139,148,168,0.08); border-color: var(--border);">v${version}</span>
        </div>
      </div>
    </div>
    <p class="blurb">${escapeHtml(description)}</p>

    <div class="qr" id="qr" aria-label="grayjay:// install deep link"></div>
    <a class="cta" id="cta" href="#">Open in Grayjay</a>

    <details class="fallback">
      <summary>Manual install</summary>
      <p>In Grayjay: Settings → Sources → Add Source by URL, paste:</p>
      <code class="url" id="url">computing…</code>
    </details>

    <div class="explainer">
      <strong>What's this?</strong> A community plugin that lets the
      <a href="https://grayjay.app" target="_blank" rel="noopener">Grayjay</a>
      video app stream content from
      <a href="${escapeHtml(platformUrl)}" target="_blank" rel="noopener">${escapeHtml(platformUrl.replace(/^https?:\/\//, ''))}</a>.
      Sign in once via the in-app webview; episodes play through Grayjay's
      player, sync to your Polycentric history, and surface in your home feed.
    </div>

    <div class="meta">
      <span><a href="./${CONFIG_FILENAME}">config.json</a> · <a href="./${SCRIPT_FILENAME}">script.js</a></span>
      <span><a href="${escapeHtml(repositoryUrl)}" target="_blank" rel="noopener">source</a></span>
    </div>
  </main>
  <footer>
    Made by <a href="${escapeHtml(authorUrl)}" target="_blank" rel="noopener">${escapeHtml(author)}</a>.
    Not affiliated with Gas Digital Network.
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
