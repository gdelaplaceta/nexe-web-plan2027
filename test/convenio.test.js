// Pruebas sin dependencias externas: `node --test test/convenio.test.js`
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isValidDniNie, sha256Hex, usableSecret,
} from '../api/_security.js';
import {
  documentHash, normalizeFirmantes, convenioStatus, buildSignatureReceipt,
  verifySignatureReceipt, maskDip,
} from '../api/_convenio.js';

const SECRET = 'secreto-de-prueba-de-al-menos-32-caracteres';
const TEXTO = 'CONVENIO GENERAL 2027 · texto de prueba';

const A = { cargo: 'Presidencia', nombre: 'Persona A', dip: '12345678Z' };
const B = { cargo: 'Secretaría', nombre: 'Persona B', dip: 'X1234567L' };

test('letra de control de DNI y NIE', () => {
  assert.equal(isValidDniNie('12345678Z'), true);
  assert.equal(isValidDniNie('12345678A'), false, 'letra incorrecta');
  assert.equal(isValidDniNie('X1234567L'), true);
  assert.equal(isValidDniNie('Y1234567X'), true);
  assert.equal(isValidDniNie('X1234567A'), false);
  assert.equal(isValidDniNie('1234567Z'), false, 'formato incorrecto');
});

test('la huella del convenio depende del año y del texto', () => {
  assert.equal(documentHash('2027', TEXTO), documentHash('2027', TEXTO));
  assert.notEqual(documentHash('2027', TEXTO), documentHash('2027', TEXTO + ' '));
  assert.notEqual(documentHash('2027', TEXTO), documentHash('2028', TEXTO));
});

test('normaliza firmantes y rechaza datos incorrectos', () => {
  const ok = normalizeFirmantes([A, B]);
  assert.equal(ok.ok, true);
  assert.equal(ok.firmantes[1].dip, 'X1234567L');

  assert.equal(normalizeFirmantes([]).error, 'firmantes_required');
  assert.equal(normalizeFirmantes([{ ...A, dip: '12345678A' }]).error, 'invalid_dip');
  assert.equal(normalizeFirmantes([A, { ...B, dip: A.dip }]).error, 'duplicate_dip');
  assert.equal(normalizeFirmantes([{ ...A, cargo: '' }]).error, 'invalid_cargo');
  assert.equal(normalizeFirmantes(Array.from({ length: 11 }, () => A)).error, 'too_many_firmantes');
});

test('el estado solo cuenta firmas hechas sobre la huella vigente', () => {
  const hash = documentHash('2027', TEXTO);
  const otra = documentHash('2027', TEXTO + ' editado');
  const firmas = [{ dip: A.dip, docHash: hash, signedAt: '2027-01-02T10:00:00Z' }];

  let s = convenioStatus([A, B], firmas, hash);
  assert.equal(s.estado, 'pendiente_firma');
  assert.equal(s.pendientes, 1);

  s = convenioStatus([A, B], [...firmas, { dip: B.dip, docHash: hash, signedAt: 'x' }], hash);
  assert.equal(s.estado, 'aprobado');

  s = convenioStatus([A, B], [{ dip: A.dip, docHash: otra }, { dip: B.dip, docHash: otra }], hash);
  assert.equal(s.estado, 'pendiente_firma', 'firmas de otra versión no cuentan');

  assert.equal(convenioStatus([], [], hash).estado, 'sin_firmantes');
});

test('el recibo se verifica y cualquier alteración lo invalida', () => {
  const r = buildSignatureReceipt({
    ano: '2027', dip: A.dip, cargo: A.cargo, nombre: A.nombre,
    docHash: documentHash('2027', TEXTO), signedAt: '2027-01-02T10:00:00.000Z',
    ip: '10.0.0.1', userAgent: 'Mozilla/5.0 | con barra',
  }, SECRET);
  assert.equal(verifySignatureReceipt(r, SECRET), true);
  assert.equal(verifySignatureReceipt({ ...r, cargo: 'Junta' }, SECRET), false, 'cargo alterado');
  assert.equal(verifySignatureReceipt({ ...r, docHash: sha256Hex('otro') }, SECRET), false, 'texto distinto');
  assert.equal(verifySignatureReceipt({ ...r, signedAt: '2030-01-01T00:00:00Z' }, SECRET), false, 'fecha alterada');
  assert.equal(verifySignatureReceipt(r, 'otro-secreto-que-tampoco-coincide-xx'), false, 'otro secreto');
  assert.equal(verifySignatureReceipt(null, SECRET), false);
});

test('el user-agent no puede inyectar separadores en el recibo', () => {
  const r = buildSignatureReceipt({
    ano: '2027', dip: A.dip, cargo: 'C', nombre: 'N', docHash: 'h', signedAt: 't', ip: 'i',
    userAgent: 'a|b|c\n\u0000'.repeat(100),
  }, SECRET);
  assert.ok(r.userAgent.length <= 200);
  assert.equal(verifySignatureReceipt(r, SECRET), true);
});

test('un secreto corto no firma', () => {
  assert.equal(usableSecret('corto'), false);
  assert.throws(() => buildSignatureReceipt({ ano: '2027', dip: A.dip }, 'corto'));
});

test('el DIP enmascarado no revela el número completo', () => {
  assert.equal(maskDip('12345678Z'), '••••5678Z');
  assert.equal(maskDip(null), '—');
});
