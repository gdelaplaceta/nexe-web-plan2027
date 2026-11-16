// Endpoints del calendario con base de datos simulada.
// node --test --experimental-test-module-mocks test/calendario-api.test.js
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

process.env.NEXE_SESSION_SECRET = 'secreto-de-sesion-de-prueba-de-32-caracteres';
process.env.NEXE_SIGNING_SECRET = 'secreto-de-firma-de-prueba-de-32-caracteres!';

// Fecha de hoy controlable por prueba (zona horaria de Madrid).
let NOW = Date.parse('2026-11-16T11:00:00Z');
mock.method(Date, 'now', () => NOW);

const docs = [];
const audit = [];

// Cliente de base de datos falso: filtra por igualdad, como PostgREST.
function chainOf(filters) {
  const chain = {
    select() { return chain; },
    eq(c, v) { filters.push([c, v]); return chain; },
    order() { return chain; },
    then(resolve) {
      const data = docs.filter(d => filters.every(([c, v]) => d[c] === v));
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  return chain;
}

const fakeSb = {
  from(table) {
    if (table !== 'nexe_documents') throw new Error('tabla no prevista ' + table);
    return { select: () => chainOf([]) };
  },
  rpc(name, a) {
    if (name === 'nexe_save_document') {
      const i = docs.findIndex(d => d.collection_path === a.p_collection && d.document_id === a.p_document_id);
      const payload = a.p_merge && i >= 0 ? { ...docs[i].payload, ...a.p_payload } : a.p_payload;
      const owner_id = i >= 0 ? docs[i].owner_id : a.p_owner;
      const row = { collection_path: a.p_collection, document_id: a.p_document_id, owner_id, payload };
      if (i >= 0) docs[i] = row; else docs.push(row);
      audit.push({ op: 'save', collection: a.p_collection, actor: a.p_actor });
      return Promise.resolve({ data: { payload }, error: null });
    }
    if (name === 'nexe_delete_document') {
      const i = docs.findIndex(d => d.collection_path === a.p_collection && d.document_id === a.p_document_id);
      if (i >= 0) docs.splice(i, 1);
      audit.push({ op: 'delete', collection: a.p_collection });
      return Promise.resolve({ data: i >= 0, error: null });
    }
    return Promise.resolve({ data: null, error: { message: 'no prevista' } });
  },
};
const sbProxy = fakeSb;

let currentUser = null;
mock.module('../api/_supabase.js', {
  namedExports: {
    serverSupabase: () => sbProxy,
    requireUser: async () => ({ sb: sbProxy, ip: '10.0.0.9', user: currentUser }),
    requireSameOrigin: () => {},
    sendAuthError: () => false,
  },
});
const { default: handler } = await import('../api/calendario.js');

function res() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
async function call(method, query, body) {
  const r = res();
  await handler({ method, query: query || {}, body, headers: {} }, r);
  return r;
}

const ADMIN = { id: 'u-admin', dip: '12345678Z', name: 'Admin', role: 'administracion' };
const PERSONA = { id: 'u-p', dip: '87654321X', name: 'Persona', role: 'aspirante' };
const OTRA = { id: 'u-o', dip: '11111111H', name: 'Otra', role: 'aspirante' };
const as = u => { currentUser = u; };

function reset() { docs.length = 0; audit.length = 0; }

test('la consulta devuelve festivos, saldo y estado de las actividades', async () => {
  reset(); as(PERSONA);
  const r = await call('GET', { ano: '2027' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.data.festivos.length, 30);
  assert.equal(r.body.data.descansos.disponibles, 10);
  assert.equal(r.body.data.administra, false);
});

test('solicitar un día individual con siete días de antelación', async () => {
  reset(); as(PERSONA);
  const r = await call('POST', {}, { action: 'solicitar_descanso', ano: '2027', fecha: '2027-05-10' });
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  const g = await call('GET', { ano: '2027' });
  assert.equal(g.body.data.descansos.pendientes, 1);
  assert.equal(g.body.data.descansos.disponibles, 9);
});

test('no se solicita un día con menos de siete días de antelación', async () => {
  reset(); as(PERSONA);
  NOW = Date.parse('2027-03-02T11:00:00Z');
  try {
    const r = await call('POST', {}, { action: 'solicitar_descanso', ano: '2027', fecha: '2027-03-06' });
    assert.equal(r.statusCode, 409);
    assert.equal(r.body.error, 'antelacion_insuficiente');
    const ok = await call('POST', {}, { action: 'solicitar_descanso', ano: '2027', fecha: '2027-03-09' });
    assert.equal(ok.statusCode, 201, 'exactamente siete días');
  } finally {
    NOW = Date.parse('2026-11-16T11:00:00Z');
  }
});

test('no se solicita un festivo ni el mismo día dos veces', async () => {
  reset(); as(PERSONA);
  assert.equal((await call('POST', {}, { action: 'solicitar_descanso', ano: '2027', fecha: '2027-03-23' })).body.error, 'es_festivo');
  await call('POST', {}, { action: 'solicitar_descanso', ano: '2027', fecha: '2027-05-10' });
  assert.equal((await call('POST', {}, { action: 'solicitar_descanso', ano: '2027', fecha: '2027-05-10' })).body.error, 'ya_solicitado');
});

test('diez días por persona: el undécimo se rechaza', async () => {
  reset(); as(PERSONA);
  const fechas = ['2027-05-03', '2027-05-04', '2027-05-05', '2027-05-06', '2027-05-07', '2027-05-10', '2027-05-11', '2027-05-12', '2027-05-13', '2027-05-14'];
  for (const fecha of fechas) {
    const r = await call('POST', {}, { action: 'solicitar_descanso', ano: '2027', fecha });
    assert.equal(r.statusCode, 201, fecha);
  }
  const extra = await call('POST', {}, { action: 'solicitar_descanso', ano: '2027', fecha: '2027-06-01' });
  assert.equal(extra.statusCode, 409);
  assert.equal(extra.body.error, 'sin_saldo');
});

test('la persona solo cancela sus solicitudes pendientes', async () => {
  reset(); as(PERSONA);
  await call('POST', {}, { action: 'solicitar_descanso', ano: '2027', fecha: '2027-05-10' });
  const id = docs[0].document_id;
  as(OTRA);
  assert.equal((await call('POST', {}, { action: 'cancelar_descanso', ano: '2027', id })).statusCode, 404, 'no es suya');
  as(PERSONA);
  assert.equal((await call('POST', {}, { action: 'cancelar_descanso', ano: '2027', id })).statusCode, 200);
  assert.equal(docs.length, 0);
});

test('solo administración publica actividades y revisa descansos', async () => {
  reset(); as(PERSONA);
  assert.equal((await call('POST', {}, { action: 'publicar_actividad', ano: '2027', titulo: 'x', fecha: '2027-04-23' })).statusCode, 403);
  assert.equal((await call('POST', {}, { action: 'revisar_descanso', ano: '2027', id: 'x', decision: 'aprobar' })).statusCode, 403);
});

test('actividad aceptada bloquea el día individual; el día aprobado bloquea la actividad', async () => {
  reset(); as(ADMIN);
  const pub = await call('POST', {}, { action: 'publicar_actividad', ano: '2027', titulo: 'Huerta', fecha: '2027-05-10', descripcion: 'Jornada' });
  assert.equal(pub.statusCode, 201);
  const actId = docs.find(d => d.collection_path.endsWith('/actividades')).document_id;

  as(PERSONA);
  assert.equal((await call('POST', {}, { action: 'aceptar_actividad', ano: '2027', actividadId: actId })).statusCode, 200);
  const bloqueado = await call('POST', {}, { action: 'solicitar_descanso', ano: '2027', fecha: '2027-05-10' });
  assert.equal(bloqueado.body.error, 'conflicto_actividad');

  // Otra persona sí puede pedir ese día y después aprobarlo.
  as(OTRA);
  assert.equal((await call('POST', {}, { action: 'solicitar_descanso', ano: '2027', fecha: '2027-05-10' })).statusCode, 201);
  const solId = docs.find(d => d.collection_path.endsWith('/descansos')).document_id;
  as(ADMIN);
  assert.equal((await call('POST', {}, { action: 'revisar_descanso', ano: '2027', id: solId, decision: 'aprobar' })).statusCode, 200);

  as(PERSONA);
  const conflicto = await call('POST', {}, { action: 'renunciar_actividad', ano: '2027', actividadId: actId });
  assert.equal(conflicto.statusCode, 200, 'puede renunciar');
});

test('no se acepta una actividad en una fecha con descanso aprobado', async () => {
  reset(); as(ADMIN);
  await call('POST', {}, { action: 'publicar_actividad', ano: '2027', titulo: 'Radio', fecha: '2027-05-11' });
  const actId = docs[0].document_id;
  as(PERSONA);
  await call('POST', {}, { action: 'solicitar_descanso', ano: '2027', fecha: '2027-05-11' });
  const solId = docs.find(d => d.collection_path.endsWith('/descansos')).document_id;
  as(ADMIN);
  await call('POST', {}, { action: 'revisar_descanso', ano: '2027', id: solId, decision: 'aprobar' });
  as(PERSONA);
  const r = await call('POST', {}, { action: 'aceptar_actividad', ano: '2027', actividadId: actId });
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.error, 'conflicto_descanso');
});

test('al aprobar se comprueba de nuevo el conflicto con una actividad aceptada después', async () => {
  reset(); as(ADMIN);
  await call('POST', {}, { action: 'publicar_actividad', ano: '2027', titulo: 'Taller', fecha: '2027-05-12' });
  const actId = docs[0].document_id;
  as(PERSONA);
  await call('POST', {}, { action: 'solicitar_descanso', ano: '2027', fecha: '2027-05-12' });
  // Con la solicitud solo pendiente, la actividad sí puede aceptarse: el conflicto
  // se comprueba al aprobar, que es cuando el descanso pasa a ser firme.
  const r = await call('POST', {}, { action: 'aceptar_actividad', ano: '2027', actividadId: actId });
  assert.equal(r.statusCode, 200, 'con solicitud pendiente aún se puede aceptar');
  as(ADMIN);
  const solId = docs.find(d => d.collection_path.endsWith('/descansos')).document_id;
  const aprobar = await call('POST', {}, { action: 'revisar_descanso', ano: '2027', id: solId, decision: 'aprobar' });
  assert.equal(aprobar.statusCode, 409);
  assert.equal(aprobar.body.error, 'conflicto_actividad');
});

test('rechazar exige motivo; el propietario de la solicitud no cambia', async () => {
  reset(); as(PERSONA);
  await call('POST', {}, { action: 'solicitar_descanso', ano: '2027', fecha: '2027-05-13' });
  const solId = docs.find(d => d.collection_path.endsWith('/descansos')).document_id;
  const owner = docs.find(d => d.collection_path.endsWith('/descansos')).owner_id;
  as(ADMIN);
  assert.equal((await call('POST', {}, { action: 'revisar_descanso', ano: '2027', id: solId, decision: 'rechazar', motivo: 'no' })).body.error, 'motivo_requerido');
  assert.equal((await call('POST', {}, { action: 'revisar_descanso', ano: '2027', id: solId, decision: 'rechazar', motivo: 'Coincide con la visita de la Junta' })).statusCode, 200);
  assert.equal(docs.find(d => d.document_id === solId).owner_id, owner, 'la solicitud sigue siendo de quien la pidió');
});

test('la consulta de administración incluye las solicitudes pendientes de revisar con DIP enmascarado', async () => {
  reset(); as(PERSONA);
  await call('POST', {}, { action: 'solicitar_descanso', ano: '2027', fecha: '2027-05-14' });
  as(ADMIN);
  const r = await call('GET', { ano: '2027' });
  assert.equal(r.body.data.pendientesRevision.length, 1);
  assert.equal(r.body.data.pendientesRevision[0].dip, '••••4321X');
  assert.equal(JSON.stringify(r.body).includes('87654321X'), false);
});

test('el registro de auditoría recoge cada escritura', async () => {
  reset(); as(PERSONA);
  await call('POST', {}, { action: 'solicitar_descanso', ano: '2027', fecha: '2027-05-15' });
  assert.ok(audit.some(a => a.op === 'save' && a.collection.endsWith('/descansos')));
});
