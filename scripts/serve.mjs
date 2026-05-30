#!/usr/bin/env node
// Local dev server for sideloading the Grayjay plugin onto a phone.
//
// Two concerns the prod build doesn't solve:
//
//   1. Grayjay resolves scriptUrl/iconUrl relative to the config's sourceUrl,
//      not the URL it fetched the config from. The prod build bakes sourceUrl
//      = https://tfolbrecht.github.io/... — fine for Pages, fatal for LAN.
//      We rewrite sourceUrl/scriptUrl/iconUrl to the requesting Host per-request
//      so the same dist/ works locally without re-baking the config.
//
//   2. Two installs with the same `id` collide on the phone — Grayjay treats
//      the second one as an UPDATE, not a sibling source. So dev gets a
//      different id and a "Dev GaS Digital" name; both can coexist with the
//      prod install on the same device.
//
// All rewrites happen per-request — the dist/ artifact itself is not mutated.

import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';

const DIST = resolve(process.cwd(), 'dist');
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

const CONFIG_FILENAME = 'GasDigitalConfig.json';
const SCRIPT_FILENAME = 'GasDigitalScript.js';
const ICON_FILENAME = 'GasDigitalIcon.png';
const LANDING_FILENAME = 'index.html';
const OG_CARD_FILENAME = 'og-card.svg';

// Distinct identity for the dev install. UUID is stable so dev re-installs over
// the previous dev install (an "update") rather than spawning a new sibling.
const PROD_NAME = 'Gas Digital';
const DEV_NAME = 'Dev GaS Digital';
const DEV_ID = 'd4e0c5e0-de4d-4d4d-8d11-d3bd1a9b7c01';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

if (!existsSync(DIST)) {
  console.error(`dist/ not found — run \`npm run build\` first`);
  process.exit(1);
}

function safeJoin(root, p) {
  const j = normalize(join(root, p));
  if (!j.startsWith(root)) return null;
  return j;
}

function rewriteConfig(filePath, originBase) {
  const cfg = JSON.parse(readFileSync(filePath, 'utf8'));
  cfg.name = DEV_NAME;
  cfg.id = DEV_ID;
  cfg.sourceUrl = `${originBase}/${CONFIG_FILENAME}`;
  cfg.scriptUrl = `${originBase}/${SCRIPT_FILENAME}`;
  cfg.iconUrl = `${originBase}/${ICON_FILENAME}`;
  // Signing covers script bytes only; rewriting config doesn't break the sig.
  return JSON.stringify(cfg, null, 2) + '\n';
}

function rewriteHtml(filePath) {
  let html = readFileSync(filePath, 'utf8');
  // Globally swap brand name. Done with a literal replace (not regex) to
  // avoid touching anything case-sensitive elsewhere.
  html = html.split(PROD_NAME).join(DEV_NAME);
  // Re-tint the accent for visual differentiation (orange -> cyan).
  html = html.replaceAll('#ff6b35', '#22d3ee');
  html = html.replaceAll('rgba(255,107,53', 'rgba(34,211,238');
  html = html.replaceAll('rgba(255, 107, 53', 'rgba(34, 211, 238');
  return html;
}

function rewriteSvg(filePath) {
  return readFileSync(filePath, 'utf8')
    .split(PROD_NAME).join(DEV_NAME)
    .replaceAll('#ff6b35', '#22d3ee');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://placeholder');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/' + LANDING_FILENAME;

  const filePath = safeJoin(DIST, pathname);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (pathname.endsWith(`/${CONFIG_FILENAME}`)) {
    const host = req.headers.host ?? `localhost:${PORT}`;
    const originBase = `http://${host}`;
    const body = rewriteConfig(filePath, originBase);
    res.writeHead(200, { 'Content-Type': TYPES['.json'] });
    res.end(body);
    console.log(`${req.method} ${pathname} -> dev install (id=${DEV_ID}, base=${originBase})`);
    return;
  }

  if (pathname.endsWith(`/${LANDING_FILENAME}`)) {
    res.writeHead(200, { 'Content-Type': TYPES['.html'] });
    res.end(rewriteHtml(filePath));
    return;
  }

  if (pathname.endsWith(`/${OG_CARD_FILENAME}`)) {
    res.writeHead(200, { 'Content-Type': TYPES['.svg'] });
    res.end(rewriteSvg(filePath));
    return;
  }

  const type = TYPES[extname(pathname)] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  createReadStream(filePath).pipe(res);
});

server.listen(PORT, HOST, () => {
  const ips = ['localhost', '127.0.0.1'];
  for (const ifs of Object.values(networkInterfaces())) {
    for (const i of ifs ?? []) {
      if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    }
  }
  console.log(`serving ${DIST} (${DEV_NAME}, id ${DEV_ID}) on http://${HOST}:${PORT}`);
  for (const ip of ips) console.log(`  http://${ip}:${PORT}/`);
});
