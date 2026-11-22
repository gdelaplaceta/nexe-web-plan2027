// Lógica pura del convenio general: huella del texto, firmantes, recibos de
// firma y estado de aprobación. No toca la base de datos.
import crypto from 'node:crypto';
import { isValidDniNie, sha256Hex, hmacBase64Url, safeEqual, usableSecret } from './_security.js';

// Código seguro de verificación (CSV). Alfabeto sin I, L, O, U para evitar confusiones.
const CSV_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CSV_PATTERN = /^NXE-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

export const MAX_FIRMANTES = 10;
export const CONVENIO_FIELDS_MAX = { titulo: 200, cargo: 80, nombre: 120, acuerdoRef: 120 };

export function maskDip(dip) {
  const text = String(dip || '');
  return text.length >= 5 ? `••••${text.slice(-5)}` : '—';
}

// Huella del texto aprobado. Cualquier cambio en el texto cambia la huella y
// invalida las firmas anteriores, que quedan ligadas a una versión concreta.
export function documentHash(ano, texto) {
  return sha256Hex(`NEXE-CONVENIO|${ano}|${texto}`);
}

// Valida la lista de firmantes que escribe administración.
// Formato: [{ cargo, dip, nombre }]. Devuelve { ok, firmantes | error }.
export function normalizeFirmantes(input) {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: 'firmantes_required' };
  if (input.length > MAX_FIRMANTES) return { ok: false, error: 'too_many_firmantes' };
  const seen = new Set();
  const firmantes = [];
  for (const item of input) {
    const cargo = String(item?.cargo || '').trim();
    const nombre = String(item?.nombre || '').trim();
    const dip = String(item?.dip || '').trim().toUpperCase().replace(/[ -]/g, '');
    if (!cargo || cargo.length > CONVENIO_FIELDS_MAX.cargo) return { ok: false, error: 'invalid_cargo' };
    if (!nombre || nombre.length > CONVENIO_FIELDS_MAX.nombre) return { ok: false, error: 'invalid_nombre' };
    if (!isValidDniNie(dip)) return { ok: false, error: 'invalid_dip' };
    if (seen.has(dip)) return { ok: false, error: 'duplicate_dip' };
    seen.add(dip);
    firmantes.push({ cargo, nombre, dip });
  }
  return { ok: true, firmantes };
}

// Estado del convenio a partir de los firmantes y de las firmas registradas.
// Solo cuentan las firmas hechas sobre la huella vigente del texto.
export function convenioStatus(firmantes, firmas, docHash) {
  const firmadas = new Map();
  for (const firma of firmas || []) {
    if (firma?.docHash === docHash && firma?.dip) firmadas.set(firma.dip, firma);
  }
  const lista = (firmantes || []).map(f => ({
    cargo: f.cargo,
    nombre: f.nombre,
    dip: f.dip,
    firmado: firmadas.has(f.dip),
    firmadoAt: firmadas.get(f.dip)?.signedAt ?? null,
  }));
  const pendientes = lista.filter(f => !f.firmado).length;
  let estado = 'pendiente_firma';
  if (!lista.length) estado = 'sin_firmantes';
  else if (pendientes === 0) estado = 'aprobado';
  return { estado, firmantes: lista, pendientes, total: lista.length };
}

// Recibo de una firma. Se firma con el secreto del servidor, así no puede
// fabricarse ni alterarse desde el navegador.
const RECEIPT_FIELDS = ['ano', 'dip', 'cargo', 'nombre', 'docHash', 'signedAt', 'ip', 'userAgent', 'csv'];

function canonical(fields) {
  return JSON.stringify(RECEIPT_FIELDS.map(k => String(fields[k] ?? '')));
}

// Convierte bytes en 12 caracteres del alfabeto CSV y los agrupa en NXE-XXXX-XXXX-XXXX.
function csvFromBytes(buffer) {
  let bits = 0, value = 0, out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 12) {
      out += CSV_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length >= 12) break;
  }
  return `NXE-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

function csvFor(secret, parts) {
  const digest = crypto.createHmac('sha256', secret).update(['CSV', ...parts].join('|')).digest();
  return csvFromBytes(digest);
}

// CSV de una firma y del convenio aprobado. Dependen solo del secreto y de los datos firmados.
export function signatureCsv(secret, { ano, dip, docHash, signedAt }) {
  return csvFor(secret, ['firma', ano, dip, docHash, signedAt]);
}

export function convenioCsv(secret, { ano, docHash, approvedAt }) {
  return csvFor(secret, ['convenio', ano, docHash, approvedAt]);
}

// Acepta el código con o sin guiones y en minúsculas. Devuelve null si no es válido.
export function normalizeCsv(input) {
  const raw = String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const body = raw.startsWith('NXE') ? raw.slice(3) : raw;
  if (body.length !== 12) return null;
  const code = `NXE-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
  return CSV_PATTERN.test(code) ? code : null;
}

export function buildSignatureReceipt(fields, secret) {
  if (!usableSecret(secret)) throw new Error('signing_secret_invalid');
  const csv = signatureCsv(secret, {
    ano: String(fields.ano), dip: fields.dip, docHash: fields.docHash, signedAt: fields.signedAt,
  });
  const data = {
    csv,
    ano: String(fields.ano),
    dip: fields.dip,
    cargo: fields.cargo,
    nombre: fields.nombre,
    docHash: fields.docHash,
    signedAt: fields.signedAt,
    ip: String(fields.ip || 'desconocida'),
    userAgent: String(fields.userAgent || '').replace(/\s+/g, ' ').slice(0, 200),
  };
  return { ...data, signature: hmacBase64Url(secret, canonical(data)) };
}

export function verifySignatureReceipt(receipt, secret) {
  if (!receipt || typeof receipt !== 'object' || !usableSecret(secret)) return false;
  if (typeof receipt.signature !== 'string') return false;
  return safeEqual(receipt.signature, hmacBase64Url(secret, canonical(receipt)));
}
