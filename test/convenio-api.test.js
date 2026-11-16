// Prueba de los endpoints del convenio con un Supabase falso en memoria.
// Requiere: node --test --experimental-test-module-mocks test/convenio-api.test.js
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

process.env.NEXE_SESSION_SECRET = 'secreto-de-sesion-de-prueba-de-32-caracteres';
process.env.NEXE_SIGNING_SECRET = 'secreto-de-firma-de-prueba-de-32-caracteres!';

// --- Base de datos falsa ---------------------------------------------------
const db = { documents: [], profiles: [], audit: [] };

function builder(table) {
  const filters = [];
  const q = {
    select() { return q; },
    eq(col, val) { filters.push([col, val]); return q; },
    order() { return q; },
    maybeSingle() { return Promise.resolve({ data: match()[0] ?? null, error: null }); },
    then(resolve) { return Promise.resolve({ data: match(), error: null }).then(resolve); },
  };
  function match() {
    return db[table].filter(row => filters.every(([c, v]) => row[c] === v));
  }
  return q;
}

const fakeSb = {
  from(table) {
    if (table === 'nexe_documents') {
      return {
        select() {
          const f = [];
          const chain = {
            eq(c, v) { f.push([c, v]); return chain; },
            maybeSingle() {
              const r = db.documents.find(d => f.every(([c, v]) => d[c] === v));
              return Promise.resolve({ data: r ?? null, error: null });
            },
            then(resolve) {
              const r = db.documents.filter(d => f.every(([c, v]) => d[c] === v));
              return Promise.resolve({ data: r, error: null }).then(resolve);
            },
          };
          return chain;
        },
      };
    }
    if (table === 'nexe_profiles') {
      return {
        select() {
          const f = [];
          const chain = {
            eq(c, v) { f.push([c, v]); return chain; },
            maybeSingle() {
              const r = db.profiles.find(p => f.every(([c, v]) => p[c] === v));
              return Promise.resolve({ data: r ?? null, error: null });
            },
          };
          return chain;
        },
      };
    }
    throw new Error('tabla no prevista: ' + table);
  },
  rpc(name, args) {
    if (name === 'nexe_save_document') {
      const i = db.documents.findIndex(d => d.collection_path === args.p_collection && d.document_id === args.p_document_id);
      const row = {
        collection_path: args.p_collection,
        document_id: args.p_document_id,
        owner_id: args.p_owner,
        payload: args.p_merge && i >= 0 ? { ...db.documents[i].payload, ...args.p_payload } : args.p_payload,
      };
      if (i >= 0) db.documents[i] = row; else db.documents.push(row);
      db.audit.push({ action: 'save', collection: args.p_collection, id: args.p_document_id, actor: args.p_actor });
      return Promise.resolve({ data: { document_id: args.p_document_id, payload: row.payload }, error: null });
    }
    if (name === 'nexe_log_event') {
      db.audit.push({ action: 'event', ...args });
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: null, error: { message: 'rpc no prevista' } });
  },
};

// --- Sesión simulada ------------------------------------------------------
let currentUser = null;
mock.module('../api/_supabase.js', {
  namedExports: {
    serverSupabase: () => fakeSb,
    requireUser: async () => ({ sb: fakeSb, ip: '10.0.0.5', user: currentUser }),
    requireSameOrigin: () => {},
    sendAuthError: () => false,
    cookie: () => '',
  },
});

const { default: handler } = await import('../api/convenio.js');
const { documentHash } = await import('../api/_convenio.js');
const { TERMS_VERSION, PRIVACY_VERSION } = await import('../api/_legal.js');
const { verifyReceipt } = await import('../api/_security.js');

// --- Utilidades -------------------------------------------------------------
function res() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
async function call(method, query, body, headers = {}) {
  const r = res();
  await handler({ method, query, body, headers: { 'user-agent': 'UA-prueba', ...headers } }, r);
  return r;
}

const TEXTO = 'CONVENIO GENERAL 2027\nArtículo 1. Objeto.';
const PRES = { cargo: 'Presidencia', nombre: 'Persona Presidencia', dip: '12345678Z' };
const SEC = { cargo: 'Secretaría', nombre: 'Persona Secretaría', dip: 'X1234567L' };
const ADMIN = { id: 'uuid-admin', dip: '12345678Z', name: 'Admin', role: 'administracion' };
const MIEMBRO_SEC = { id: 'uuid-sec', dip: 'X1234567L', name: 'Secretaría', role: 'aspirante' };
const TERCERO = { id: 'uuid-3', dip: '11111111H', name: 'Tercero', role: 'aspirante' };

function reset() {
  db.documents.length = 0; db.audit.length = 0;
  db.profiles.length = 0;
  db.profiles.push(
    { id: 'uuid-admin', dip: '12345678Z', rsp_verificado: true, terminos_version: TERMS_VERSION, privacidad_version: PRIVACY_VERSION, activo: true },
    { id: 'uuid-sec', dip: 'X1234567L', rsp_verificado: true, terminos_version: TERMS_VERSION, privacidad_version: PRIVACY_VERSION, activo: true },
    { id: 'uuid-3', dip: '11111111H', rsp_verificado: false, terminos_version: TERMS_VERSION, privacidad_version: PRIVACY_VERSION, activo: true },
  );
}

async function publicar(user = ADMIN, extra = {}) {
  currentUser = user;
  return call('POST', {}, { action: 'publicar', ano: '2027', titulo: 'Convenio 2027', texto: TEXTO, firmantes: [PRES, SEC], acuerdoRef: 'Acuerdo 1/2026', ...extra });
}

// --- Pruebas ----------------------------------------------------------------
test('solo administración publica; una persona normal recibe 403', async () => {
  reset();
  const r = await publicar(MIEMBRO_SEC);
  assert.equal(r.statusCode, 403);
  assert.equal(db.documents.length, 0);
});

test('administración publica y el estado queda pendiente de firma', async () => {
  reset();
  const r = await publicar();
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.estado, 'pendiente_firma');
  assert.equal(r.body.data.total, 2);
  assert.equal(r.body.data.firmantes[0].dip, '••••5678Z', 'DIP enmascarado en la respuesta');
});

test('publicar con DIP inválido se rechaza', async () => {
  reset();
  const r = await publicar(ADMIN, { firmantes: [{ cargo: 'P', nombre: 'X', dip: '12345678A' }] });
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.error, 'invalid_dip');
});

test('firma: persona que no está en la lista recibe 403', async () => {
  reset(); await publicar();
  currentUser = TERCERO;
  const r = await call('POST', {}, { action: 'firmar', ano: '2027', confirmDip: TERCERO.dip });
  assert.equal(r.statusCode, 403);
  assert.equal(r.body.error, 'no_firmante');
});

test('firma: exige volver a escribir el propio DIP', async () => {
  reset(); await publicar();
  currentUser = MIEMBRO_SEC;
  const r = await call('POST', {}, { action: 'firmar', ano: '2027', confirmDip: '12345678Z' });
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.error, 'confirmacion_dip_incorrecta');
});

test('firma: requiere DIP verificado frente a RSP', async () => {
  reset(); await publicar();
  currentUser = TERCERO;
  db.profiles.find(p => p.dip === '11111111H').rsp_verificado = false;
  const firmanteTercero = { ...TERCERO };
  await publicar(ADMIN, { firmantes: [PRES, { cargo: 'Vocal', nombre: 'Tercero', dip: '11111111H' }] });
  currentUser = firmanteTercero;
  const r = await call('POST', {}, { action: 'firmar', ano: '2027', confirmDip: '11111111H' });
  assert.equal(r.statusCode, 403);
  assert.equal(r.body.error, 'rsp_no_verificado');
});

test('firma: un DIP con letra incorrecta no puede firmar aunque exista', async () => {
  reset();
  db.profiles.push({ id: 'uuid-x', dip: '12345678A', rsp_verificado: true, terminos_version: TERMS_VERSION, privacidad_version: PRIVACY_VERSION, activo: true });
  await publicar(ADMIN, { firmantes: [{ cargo: 'P', nombre: 'X', dip: '12345678Z' }] });
  currentUser = { id: 'uuid-x', dip: '12345678A', name: 'X', role: 'aspirante' };
  const r = await call('POST', {}, { action: 'firmar', ano: '2027', confirmDip: '12345678A' });
  assert.equal(r.statusCode, 403);
  assert.equal(r.body.error, 'no_firmante', 'no figura en la lista; la letra también se comprueba');
});

test('flujo completo: dos firmantes designados aprueban el convenio', async () => {
  reset();
  await publicar(ADMIN, { firmantes: [PRES, SEC] });
  currentUser = ADMIN;
  const r1 = await call('POST', {}, { action: 'firmar', ano: '2027', confirmDip: ADMIN.dip });
  assert.equal(r1.statusCode, 200);
  assert.equal(r1.body.estado, 'pendiente_firma');
  currentUser = MIEMBRO_SEC;
  const r2 = await call('POST', {}, { action: 'firmar', ano: '2027', confirmDip: MIEMBRO_SEC.dip });
  assert.equal(r2.statusCode, 200, JSON.stringify(r2.body));
  assert.equal(r2.body.estado, 'aprobado');
  const doc = db.documents.find(d => d.collection_path === 'convenios');
  assert.equal(doc.payload.estado, 'aprobado');
});

test('no se puede firmar dos veces la misma versión', async () => {
  reset(); await publicar(ADMIN, { firmantes: [PRES, SEC] });
  currentUser = ADMIN;
  await call('POST', {}, { action: 'firmar', ano: '2027', confirmDip: ADMIN.dip });
  const again = await call('POST', {}, { action: 'firmar', ano: '2027', confirmDip: ADMIN.dip });
  assert.equal(again.statusCode, 409);
  assert.equal(again.body.error, 'ya_firmado');
});

test('cambiar el texto invalida las firmas anteriores', async () => {
  reset(); await publicar(ADMIN, { firmantes: [PRES, SEC] });
  currentUser = ADMIN;
  await call('POST', {}, { action: 'firmar', ano: '2027', confirmDip: ADMIN.dip });
  await publicar(ADMIN, { firmantes: [PRES, SEC], texto: TEXTO + ' (corregido)' });
  const g = await call('GET', { ano: '2027' }, undefined);
  assert.equal(g.body.data.pendientes, 2, 'la firma previa ya no cuenta');
});

test('una firma alterada en la base de datos se ignora al leer', async () => {
  reset(); await publicar(ADMIN, { firmantes: [PRES, SEC] });
  currentUser = ADMIN;
  await call('POST', {}, { action: 'firmar', ano: '2027', confirmDip: ADMIN.dip });
  const firma = db.documents.find(d => d.collection_path === 'convenios/2027/firmas');
  firma.payload.nombre = 'Nombre falsificado';
  const g = await call('GET', { ano: '2027' }, undefined);
  assert.equal(g.body.data.pendientes, 2, 'firma con recibo inválido no cuenta');
});

test('la consulta no revela DIP completos a los firmantes', async () => {
  reset(); await publicar(ADMIN, { firmantes: [PRES, SEC] });
  currentUser = MIEMBRO_SEC;
  const g = await call('GET', { ano: '2027' }, undefined);
  const texto = JSON.stringify(g.body);
  assert.equal(texto.includes('12345678Z'), false);
  assert.equal(texto.includes('X1234567L'), false);
  assert.equal(g.body.data.puedoFirmar, true);
});

test('el convenio aprobado no admite nuevas publicaciones', async () => {
  reset(); await publicar(ADMIN, { firmantes: [PRES, SEC] });
  currentUser = ADMIN;
  await call('POST', {}, { action: 'firmar', ano: '2027', confirmDip: ADMIN.dip });
  currentUser = MIEMBRO_SEC;
  await call('POST', {}, { action: 'firmar', ano: '2027', confirmDip: MIEMBRO_SEC.dip });
  const r = await publicar(ADMIN, { firmantes: [PRES, SEC], texto: 'otro texto' });
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.error, 'convenio_ya_aprobado');
});

test('la huella del texto publicado coincide con la calculada aquí', async () => {
  reset(); await publicar();
  const doc = db.documents.find(d => d.collection_path === 'convenios');
  assert.equal(doc.payload.docHash, documentHash('2027', TEXTO));
});

test('el endpoint anterior de aceptación devuelve un recibo auditado', async () => {
  reset();
  currentUser = MIEMBRO_SEC;
  const text = 'Convenio de colaboración aceptado';
  const r = await call('POST', { receipt: '1' }, { texto: text, version: '2027-v1' });
  assert.equal(r.statusCode, 200);
  assert.equal(verifyReceipt(r.body.receipt, { dip: MIEMBRO_SEC.dip, text }, process.env.NEXE_SESSION_SECRET), true);
  assert.equal(db.audit[0].action, 'event');
  assert.equal(db.audit[0].p_action, 'consent');
});

test('una cuenta sin legal aceptado no puede firmar', async () => {
  reset();
  db.profiles.find(p => p.dip === 'X1234567L').terminos_version = null;
  await publicar(ADMIN, { firmantes: [PRES, SEC] });
  currentUser = MIEMBRO_SEC;
  const r = await call('POST', {}, { action: 'firmar', ano: '2027', confirmDip: MIEMBRO_SEC.dip });
  assert.equal(r.statusCode, 403);
  assert.equal(r.body.error, 'legal_pendiente');
});
