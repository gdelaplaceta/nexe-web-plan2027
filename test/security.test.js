// Pruebas de seguridad sin dependencias: `node --test test/security.test.js`
import assert from 'node:assert/strict';
import test from 'node:test';
import { signSession, verifySession, sameOrigin, clientIp, SESSION_MAX_AGE_MS } from '../api/_security.js';

const SECRET = 'secreto-de-sesion-de-prueba-de-32-caracteres';
const NOW = Date.parse('2027-01-10T10:00:00Z');

test('la sesión firmada se verifica y caduca a las 8 horas', () => {
  const token = signSession('12345678Z', SECRET, NOW);
  assert.deepEqual(verifySession(token, SECRET, NOW + 1000), { dip: '12345678Z', iat: NOW });
  assert.equal(verifySession(token, SECRET, NOW + SESSION_MAX_AGE_MS + 1), null, 'caducada');
});

test('una sesión manipulada o con otro secreto no vale', () => {
  const token = signSession('12345678Z', SECRET, NOW);
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ dip: '87654321X', iat: NOW })).toString('base64url');
  assert.equal(verifySession(`${forged}.${sig}`, SECRET, NOW), null, 'payload cambiado');
  assert.equal(verifySession(`${payload}.firma-inventada`, SECRET, NOW), null);
  assert.equal(verifySession(token, 'otro-secreto-que-no-coincide-de-32-caracteres', NOW), null);
  assert.equal(verifySession('', SECRET, NOW), null);
  assert.equal(verifySession(token, 'corto', NOW), null, 'secreto demasiado corto');
});

test('una sesión con fecha futura lejana se rechaza', () => {
  const token = signSession('12345678Z', SECRET, NOW + 3600_000);
  assert.equal(verifySession(token, SECRET, NOW), null);
});

test('solo se acepta el mismo origen para escrituras', () => {
  const req = (origin, host = 'nexe.example') => ({ headers: { host, origin } });
  assert.equal(sameOrigin(req('https://nexe.example')), true);
  assert.equal(sameOrigin(req('https://evil.example')), false);
  assert.equal(sameOrigin(req(undefined)), false, 'sin Origin se rechaza');
  assert.equal(sameOrigin(req('no es una url')), false);
  assert.equal(sameOrigin({ headers: { origin: 'https://nexe.example' } }), false, 'sin Host');
});

test('la IP se toma de la cabecera del proxy y se valida', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } }), '203.0.113.7');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': 'drop table;' } }), 'desconocida');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '198.51.100.2' } }), '198.51.100.2');
});
