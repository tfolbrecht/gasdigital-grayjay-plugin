#!/usr/bin/env node
// Generate the RSA-2048 signing keypair for this plugin.
// Private key -> .keys/private.pem  (gitignored — never commit)
// Public key  -> .keys/public.pem   (SPKI, base64 also printed for reference)
//
// Run once per plugin. Re-running refuses to overwrite an existing key unless
// `--force` is passed, since rotating the key invalidates all installed copies.

import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const dir = resolve(root, '.keys');
const priv = resolve(dir, 'private.pem');
const pub = resolve(dir, 'public.pem');
const force = process.argv.includes('--force');

if (existsSync(priv) && !force) {
  console.error(`refusing to overwrite ${priv} (pass --force to rotate)`);
  console.error('rotating the key invalidates the plugin for every existing install.');
  process.exit(1);
}

mkdirSync(dir, { recursive: true });

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

writeFileSync(priv, privateKey, { mode: 0o600 });
writeFileSync(pub, publicKey);

const spkiDer = Buffer.from(
  publicKey
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '')
    .replace(/\s+/g, ''),
  'base64',
);

console.log(`wrote ${priv} (mode 0600)`);
console.log(`wrote ${pub}`);
console.log(`\nscriptPublicKey (base64 SPKI, ${spkiDer.length}B):\n${spkiDer.toString('base64')}`);
