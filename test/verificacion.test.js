// CSV y verificación pública: `node --test test/verificacion.test.js`
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSignatureReceipt, verifySignatureReceipt, normalizeCsv, convenioCsv, signatureCsv,
  documentHash, CSV_PATTERN,
} from '../api/_convenio.js';
import { resultadoFirma, resultadoConvenio, RESULTADO_NO_ENCONTRADO } from '../api/_verificacion.js';
import { listaArchivo, fichaArchivo } from '../api/_archivo.js';

const S = 'secreto-de-firma-de-prueba-de-32-caracteres!';
const TEXTO = 'CONVENIO 2027 · texto';
const hash = documentHash('2027', TEXTO);

function firmaDe(overrides = {}) {
  return buildSignatureReceipt({
    ano: '2027', dip: '12345678Z', cargo: 'Presidencia', nombre: 'Mikel Alegre Marcos',
    docHash: hash, signedAt: '2027-01-02T10:00:00.000Z', ip: '10.0.0.1', userAgent: 'UA', ...overrides,
  }, S);
}
const CONVENIO_VIGENTE = { titulo: 'Convenio 2027', docHash: hash, estado: 'pendiente_firma' };

test('cada firma tiene un CSV con el formato NXE-XXXX-XXXX-XXXX', () => {
  const r = firmaDe();
  assert.match(r.csv, CSV_PATTERN);
  assert.equal(r.csv, signatureCsv(S, { ano: '2027', dip: '12345678Z', docHash: hash, signedAt: '2027-01-02T10:00:00.000Z' }));
});

test('el CSV depende del secreto: sin el secreto no se puede fabricar', () => {
  const otro = signatureCsv('otro-secreto-de-prueba-de-32-caracteres!', { ano: '2027', dip: '12345678Z', docHash: hash, signedAt: '2027-01-02T10:00:00.000Z' });
  assert.notEqual(otro, firmaDe().csv);
});

test('el CSV está en la firma: alterarlo invalida el recibo', () => {
  const r = firmaDe();
  assert.equal(verifySignatureReceipt(r, S), true);
  assert.equal(verifySignatureReceipt({ ...r, csv: 'NXE-AAAA-BBBB-CCCC' }, S), false);
});

test('normalización: acepta minúsculas, espacios y sin guiones; rechaza letras prohibidas', () => {
  assert.equal(normalizeCsv(' nxe-dcq3 258b y78z '), 'NXE-DCQ3-258B-Y78Z');
  assert.equal(normalizeCsv('DCQ3258BY78Z'), 'NXE-DCQ3-258B-Y78Z');
  assert.equal(normalizeCsv('NXE-ILOU-0000-0000'), null);
  assert.equal(normalizeCsv('NXE-1234-5678'), null);
  assert.equal(normalizeCsv(undefined), null);
});

test('firma auténtica sobre el texto vigente', () => {
  const r = resultadoFirma({ firma: firmaDe(), convenio: CONVENIO_VIGENTE, secret: S });
  assert.equal(r.valido, true);
  assert.equal(r.textoVigente, true);
  assert.equal(r.firmante.dip, '••••5678Z', 'el DIP no se revela completo');
  assert.equal(r.firmante.nombre, 'Mikel Alegre Marcos');
  assert.equal(r.mensaje, 'Firma auténtica sobre el texto vigente del convenio.');
  assert.equal('ip' in r, false);
  assert.equal('userAgent' in r, false);
});

test('una firma sobre una versión anterior del texto sigue siendo auténtica, pero se indica', () => {
  const r = resultadoFirma({ firma: firmaDe(), convenio: { ...CONVENIO_VIGENTE, docHash: documentHash('2027', 'otro') }, secret: S });
  assert.equal(r.valido, true);
  assert.equal(r.textoVigente, false);
  assert.match(r.mensaje, /versión anterior/);
});

test('una firma alterada en la base de datos no se verifica', () => {
  const alterada = { ...firmaDe(), nombre: 'Persona falsa' };
  const r = resultadoFirma({ firma: alterada, convenio: CONVENIO_VIGENTE, secret: S });
  assert.equal(r.valido, false);
});

test('el convenio aprobado se verifica por su CSV y su fecha de aprobación', () => {
  const approvedAt = '2027-01-03T12:00:00.000Z';
  const convenio = { titulo: 'Convenio 2027', docHash: hash, estado: 'aprobado', approvedAt, csv: convenioCsv(S, { ano: '2027', docHash: hash, approvedAt }) };
  const ok = resultadoConvenio({ convenio, ano: '2027', secret: S });
  assert.equal(ok.valido, true);
  assert.equal(ok.convenioAprobado, true);
  const falso = resultadoConvenio({ convenio: { ...convenio, approvedAt: '2030-01-01T00:00:00.000Z' }, ano: '2027', secret: S });
  assert.equal(falso.valido, false, 'cambiar la fecha de aprobación invalida el código');
  const pendiente = resultadoConvenio({ convenio: { ...convenio, estado: 'pendiente_firma' }, ano: '2027', secret: S });
  assert.equal(pendiente.valido, false);
});

test('código inexistente: respuesta genérica', () => {
  assert.equal(RESULTADO_NO_ENCONTRADO.valido, false);
  assert.equal(RESULTADO_NO_ENCONTRADO.tipo, null);
});

test('lista de archivo: roles calculados por persona, incluido multirol', () => {
  const conv = [
    { document_id: 'c1', payload: { titulo: 'Administrativo/a', rolConcedido: 'administracion' } },
    { document_id: 'c2', payload: { titulo: 'Secretaría', rolConcedido: 'secretaria' } },
  ];
  const lista = listaArchivo({
    profiles: [
      { id: 'u1', dip: '12345678Z', nombre: 'Ana', rol: 'aspirante', activo: true, rsp_verificado: true },
      { id: 'u2', dip: '87654321X', nombre: 'Bruno', rol: 'aspirante', activo: true, rsp_verificado: false },
    ],
    resDocs: [
      { collection_path: 'notas/12345678Z/res', document_id: 'c1', payload: { estado: 'plaza' } },
      { collection_path: 'notas/12345678Z/res', document_id: 'c2', payload: { estado: 'plaza' } },
    ],
    convDocs: conv,
    firmas: [{ payload: { dip: '12345678Z', signedAt: '2027-01-05T00:00:00Z' } }],
  });
  const ana = lista.find(p => p.dip === '12345678Z');
  assert.deepEqual(ana.roles, ['administracion', 'secretaria', 'aspirante']);
  assert.equal(ana.rolPrincipal, 'administracion');
  assert.equal(ana.firmasConvenio, 1);
  assert.equal(ana.plazas.length, 2);
  const bruno = lista.find(p => p.dip === '87654321X');
  assert.deepEqual(bruno.roles, ['aspirante'], 'sin plazas es aspirante');
  assert.equal(bruno.rspVerificado, false);
});

test('ficha de archivo: plazas, firmas con CSV y descansos de una persona', () => {
  const ficha = fichaArchivo({
    dip: '12345678Z', nombre: 'Ana',
    convDocs: [{ document_id: 'c2', payload: { titulo: 'Secretaría', rolConcedido: 'secretaria' } }],
    plazas: [{ document_id: 'c2', payload: { estado: 'plaza' } }],
    firmas: [{ payload: { ano: '2027', cargo: 'Secretaría', signedAt: '2027-01-05T00:00:00Z', csv: 'NXE-AAAA-BBBB-CCCC' } }],
    descansos: [{ payload: { fecha: '2027-05-10', estado: 'aprobada' } }, { payload: { fecha: '2027-02-01', estado: 'pendiente' } }],
    aceptaciones: [{ payload: { fecha: '2027-04-10', aceptadaAt: '2026-12-01' } }],
    convenioAceptado: { acceptedAt: '2026-12-01T10:00:00Z', version: '2026.10' },
  });
  assert.equal(ficha.plazas[0].convocatoria, 'Secretaría');
  assert.equal(ficha.plazas[0].rolConcedido, 'secretaria');
  assert.equal(ficha.firmasConvenio[0].csv, 'NXE-AAAA-BBBB-CCCC');
  assert.equal(ficha.descansos[0].fecha, '2027-02-01', 'ordenados por fecha');
  assert.equal(ficha.convenioAceptado.version, '2026.10');
});
