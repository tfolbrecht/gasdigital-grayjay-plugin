#!/usr/bin/env node
// Sign dist/GasDigitalScript.js with the RSA-2048 private key at .keys/private.pem,
// then inject `scriptSignature` and `scriptPublicKey` into dist/GasDigitalConfig.json.
//
// Algorithm: RSASSA-PKCS1-v1_5 + SHA-512, signature base64-encoded.
// Public key: base64 SPKI DER.
//
// If .keys/private.pem is absent, emits a warning and leaves the dist config
// unsigned (empty signature). This lets dev builds run without the key around.

import { createPrivateKey, createPublicKey, createSign } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const privPath = resolve(root, '.keys/private.pem');
const scriptPath = resolve(root, 'dist/GasDigitalScript.js');
const configPath = resolve(root, 'dist/GasDigitalConfig.json');

if (!existsSync(scriptPath) || !existsSync(configPath)) {
  console.error('dist not built — run `npm run build` first');
  process.exit(1);
}

if (!existsSync(privPath)) {
  console.warn(`warning: ${privPath} not found — leaving dist unsigned`);
  console.warn('run `npm run keygen` to create a signing key');
  process.exit(0);
}

const privateKey = createPrivateKey(readFileSync(privPath));
const publicKey = createPublicKey(privateKey);
const spkiDerBase64 = publicKey
  .export({ type: 'spki', format: 'der' })
  .toString('base64');

const scriptBytes = readFileSync(scriptPath);
const signer = createSign('SHA512');
signer.update(scriptBytes);
const signature = signer.sign(privateKey).toString('base64');

const config = JSON.parse(readFileSync(configPath, 'utf8'));
config.scriptSignature = signature;
config.scriptPublicKey = spkiDerBase64;
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

// The Vite plugin emits dist/index.html before this script runs, so the badge
// is baked as "unsigned". Patch it in place rather than duplicate the landing
// template here — string match is tight enough that an unrelated edit can't
// silently re-flip it.
const landingPath = resolve(root, 'dist/index.html');
if (existsSync(landingPath)) {
  const before = readFileSync(landingPath, 'utf8');
  const after = before.replace(
    /<span class="badge unsigned">unsigned<\/span>/g,
    '<span class="badge signed">signed</span>',
  );
  if (after !== before) writeFileSync(landingPath, after);
}

console.log(`signed ${scriptPath}`);
console.log(`  sig:    ${signature.length}B base64`);
console.log(`  pubkey: ${spkiDerBase64.length}B base64 SPKI`);
