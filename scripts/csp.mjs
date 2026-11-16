// Calcula las huellas de los scripts en línea de maqueta.html y actualiza la
// Content-Security-Policy de vercel.json. Ejecutar tras cualquier cambio en el
// script principal:   node scripts/csp.mjs
//   node scripts/csp.mjs --check   → falla si vercel.json no coincide (para CI y tests)
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function inlineScriptHashes(html) {
  // Solo <script> sin atributos: los externos (<script src>) se cubren con 'self'.
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(m => `'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
}

export function buildCsp(hashes) {
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function securityHeaders(csp) {
  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), payment=(), microphone=(), usb=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  ];
}

export function buildVercelConfig(base, csp) {
  return {
    ...base,
    headers: [
      { source: '/(.*)', headers: securityHeaders(csp) },
      { source: '/api/(.*)', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const html = fs.readFileSync(path.join(root, 'maqueta.html'), 'utf8');
  const hashes = inlineScriptHashes(html);
  if (hashes.length !== 1) {
    console.error(`Se esperaba un único script en línea y hay ${hashes.length}. Revisa maqueta.html.`);
    process.exit(1);
  }
  const csp = buildCsp(hashes);
  const file = path.join(root, 'vercel.json');
  const current = JSON.parse(fs.readFileSync(file, 'utf8'));
  const next = buildVercelConfig({ cleanUrls: current.cleanUrls, rewrites: current.rewrites }, csp);
  if (process.argv.includes('--check')) {
    const same = JSON.stringify(next.headers) === JSON.stringify(current.headers);
    if (!same) { console.error('vercel.json no coincide con maqueta.html. Ejecuta: node scripts/csp.mjs'); process.exit(1); }
    console.log('CSP al día.');
  } else {
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
    console.log('vercel.json actualizado. Huella:', hashes[0]);
  }
}
