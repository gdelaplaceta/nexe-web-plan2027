// Utilidades de seguridad sin dependencias externas.
// Este módulo no importa Supabase para que sus funciones puedan probarse
// con `node --test` aunque no estén instaladas las dependencias.
import crypto from 'node:crypto';

export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const MAX_JSON_BYTES = 200 * 1024;
export const MAX_TEXT_BYTES = 150 * 1024;

const DIP_PATTERN = /^([0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z])$/;

export function isDip(value) {
  return typeof value === 'string' && DIP_PATTERN.test(value);
}

// Comprueba además la letra de control (módulo 23). Detecta errores de
// tecleo que el formato por sí solo no detecta.
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const NIE_PREFIX = { X: '0', Y: '1', Z: '2' };
export function isValidDniNie(value) {
  if (!isDip(value)) return false;
  const number = NIE_PREFIX[value[0]]
    ? NIE_PREFIX[value[0]] + value.slice(1, 8)
    : value.slice(0, 8);
  return DNI_LETTERS[Number(number) % 23] === value[8];
}

export function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function hmacBase64Url(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function usableSecret(secret) {
  return typeof secret === 'string' && secret.length >= 32;
}

// Formato de cookie de sesión: base64url(JSON{dip,iat}) "." HMAC(payload).
export function signSession(dip, secret, now = Date.now()) {
  if (!usableSecret(secret)) throw new Error('session_secret_invalid');
  if (!isDip(dip)) throw new Error('dip_invalid');
  const payload = Buffer.from(JSON.stringify({ dip, iat: now })).toString('base64url');
  return `${payload}.${hmacBase64Url(secret, payload)}`;
}

export function verifySession(raw, secret, now = Date.now()) {
  if (!usableSecret(secret) || typeof raw !== 'string' || !raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;
  if (!safeEqual(signature, hmacBase64Url(secret, payload))) return null;
  let session;
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const iat = Number(session?.iat);
  if (!isDip(session?.dip) || !Number.isFinite(iat)) return null;
  if (now - iat > SESSION_MAX_AGE_MS || iat - now > 60 * 1000) return null;
  return { dip: session.dip, iat };
}

// Comprueba que la petición llega desde el mismo sitio. Los navegadores
// envían Origin en POST/PUT/PATCH/DELETE; si falta, se rechaza.
export function sameOrigin(req) {
  const host = String(req.headers?.host || '').toLowerCase();
  const origin = String(req.headers?.origin || '');
  if (!host || !origin) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

export function clientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.socket?.remoteAddress || '';
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : 'desconocida';
}

export function jsonSize(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Recibo de aceptación del convenio. Une persona, versión, huella del texto,
// IP y momento de la firma. Se firma con el secreto del servidor, así el
// cliente no puede fabricar un recibo válido ni alterar el texto aceptado.
export function receiptFields({ dip, version, textHash, signedAt, ip }) {
  return [dip, version, textHash, signedAt, ip].map(v => String(v ?? '')).join('|');
}

export function buildReceipt({ dip, version, text, signedAt, ip }, secret) {
  const textHash = sha256Hex(text);
  const fields = { dip, version, textHash, signedAt, ip };
  return { ...fields, signature: hmacBase64Url(secret, receiptFields(fields)) };
}

export function verifyReceipt(receipt, { dip, text }, secret, now = Date.now()) {
  if (!isPlainObject(receipt) || !usableSecret(secret)) return false;
  if (receipt.dip !== dip) return false;
  if (typeof receipt.version !== 'string' || receipt.version.length > 40) return false;
  if (receipt.textHash !== sha256Hex(text)) return false;
  const signedAt = Date.parse(receipt.signedAt);
  if (!Number.isFinite(signedAt) || Math.abs(now - signedAt) > 24 * 60 * 60 * 1000) return false;
  const expected = hmacBase64Url(secret, receiptFields(receipt));
  return typeof receipt.signature === 'string' && safeEqual(receipt.signature, expected);
}
