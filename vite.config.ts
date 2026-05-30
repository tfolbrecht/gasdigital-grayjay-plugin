import { defineConfig, type Plugin } from 'vite';
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build as esbuild } from 'esbuild';

const SCRIPT_FILENAME = 'GasDigitalScript.js';
const CONFIG_FILENAME = 'GasDigitalConfig.json';
const ICON_FILENAME = 'GasDigitalIcon.png';
const LANDING_FILENAME = 'index.html';

const REQUIRED_CONFIG_FIELDS = [
  'name', 'description', 'author', 'authorUrl',
  'sourceUrl', 'repositoryUrl', 'scriptUrl', 'version',
  'id', 'iconUrl', 'scriptSignature', 'scriptPublicKey',
  'packages', 'allowEval', 'allowUrls',
] as const;

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

function landingHtml(pluginName: string, version: number, qrcodeJs: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${pluginName} — Grayjay plugin</title>
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
      display: grid;
      place-items: center;
      padding: 24px;
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
  </style>
</head>
<body>
  <main>
    <span class="badge">Grayjay source</span>
    <h1>${pluginName}</h1>
    <p class="lead">Scan with the Grayjay in-app QR scanner, or tap <em>Open in Grayjay</em> on a phone where Grayjay is installed.</p>
    <div class="qr" id="qr" aria-label="grayjay:// install deep link"></div>
    <a class="cta" id="cta" href="#">Open in Grayjay</a>
    <details class="fallback">
      <summary>Manual install</summary>
      <p>Settings → Sources → Add Source by URL, paste:</p>
      <code class="url" id="url">computing…</code>
    </details>
    <div class="meta">
      <span>version <code>${version}</code></span>
      <span><a href="./${CONFIG_FILENAME}">config</a> · <a href="./${SCRIPT_FILENAME}">script</a></span>
    </div>
  </main>
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
      writeFileSync(
        resolve(outDir, LANDING_FILENAME),
        landingHtml(String(config.name), config.version as number, qrcodeJs),
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
