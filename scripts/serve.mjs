#!/usr/bin/env node
// Local dev server for sideloading the Grayjay plugin onto a phone.
//
// Why not http-server? Grayjay resolves the script/icon URLs relative to the
// config's `sourceUrl` field, not the URL it fetched the config from. So when
// the published `sourceUrl` is https://plugins.grayjay.app/..., relative paths
// resolve to that origin and the script fetch 404s.
//
// This server rewrites `sourceUrl`, `scriptUrl`, and `iconUrl` to absolute URLs
// on the requesting origin (using the Host header) so relative resolution lands
// on this server.

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
  cfg.sourceUrl = `${originBase}/${CONFIG_FILENAME}`;
  cfg.scriptUrl = `${originBase}/${SCRIPT_FILENAME}`;
  cfg.iconUrl = `${originBase}/${ICON_FILENAME}`;
  return JSON.stringify(cfg, null, 2) + '\n';
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://placeholder');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

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
    console.log(`${req.method} ${pathname} -> rewrote sourceUrl to ${originBase}/${CONFIG_FILENAME}`);
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
  console.log(`serving ${DIST} on http://${HOST}:${PORT}`);
  for (const ip of ips) console.log(`  http://${ip}:${PORT}/`);
});
