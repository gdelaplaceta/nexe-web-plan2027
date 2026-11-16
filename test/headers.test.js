// Cabeceras y CSP: `node --test test/headers.test.js`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { inlineScriptHashes, buildCsp } from '../scripts/csp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const vercel = JSON.parse(read('vercel.json'));
const headers = Object.fromEntries(vercel.headers[0].headers.map(h => [h.key, h.value]));

test('la CSP coincide con el script en línea actual de maqueta.html', () => {
  const hashes = inlineScriptHashes(read('maqueta.html'));
  assert.equal(hashes.length, 1, 'un único script en línea');
  assert.equal(headers['Content-Security-Policy'], buildCsp(hashes),
    'ejecuta: node scripts/csp.mjs (el script cambió y la huella ya no coincide)');
});

test('la política no permite scripts en línea genéricos ni eval', () => {
  const csp = headers['Content-Security-Policy'];
  const scriptSrc = csp.split(';').find(d => d.trim().startsWith('script-src'));
  assert.equal(scriptSrc.includes("'unsafe-inline'"), false);
  assert.equal(scriptSrc.includes("'unsafe-eval'"), false);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /default-src 'self'/);
});

test('no hay fuentes externas ni hosts de terceros en la política', () => {
  const csp = headers['Content-Security-Policy'];
  assert.equal(/googleapis|gstatic|cdn\.|jsdelivr|unpkg/.test(csp), false);
});

test('cabeceras de transporte y aislamiento', () => {
  assert.match(headers['Strict-Transport-Security'], /max-age=\d{8,}/);
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(headers['Cross-Origin-Resource-Policy'], 'same-origin');
  assert.match(headers['Permissions-Policy'], /camera=\(\)/);
});

test('la API nunca se guarda en caché', () => {
  const api = vercel.headers.find(h => h.source === '/api/(.*)');
  assert.ok(api);
  assert.deepEqual(api.headers, [{ key: 'Cache-Control', value: 'no-store' }]);
});

test('ningún HTML usa manejadores de eventos en línea', () => {
  for (const f of ['maqueta.html', 'index.html', 'legal/privacidad.html', 'legal/terminos.html']) {
    const html = read(f);
    assert.equal(/\son[a-z]+\s*=\s*["']/i.test(html), false, `${f} tiene atributos on*`);
  }
});

test('las fuentes son autohospedadas', () => {
  const html = read('maqueta.html');
  assert.equal(/fonts\.googleapis|fonts\.gstatic/.test(html), false);
});

test('el generador PDF se carga solo cuando se solicita una descarga', () => {
  const html = read('maqueta.html');
  assert.equal(/<script\s+src=["']\/agreement-pdf\.js["']/.test(html), false);
  assert.match(html, /script\.src='\/agreement-pdf\.js'/);
});
