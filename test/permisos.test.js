// Pruebas de reglas de permiso sin dependencias: `node --test test/permisos.test.js`
import assert from 'node:assert/strict';
import test from 'node:test';
import { readPlan, writePlan } from '../api/_permissions.js';

const ADMIN = { id: 'u-admin', dip: '12345678Z', role: 'administracion' };
const PERSONA = { id: 'u-persona', dip: '87654321X', role: 'aspirante' };
const OTRA = { id: 'u-otra', dip: '11111111H', role: 'aspirante' };

test('convenio: todas las personas activas leen el texto; firmas y firmantes solo administración', () => {
  assert.equal(readPlan('convenios', '2027', PERSONA).allow, true);
  assert.equal(readPlan('convenios/2027/firmas', null, PERSONA).allow, false);
  assert.equal(readPlan('convenios/2027/firmantes', 'lista', PERSONA).allow, false);
  assert.equal(readPlan('convenios/2027/firmas', null, ADMIN).allow, true);
});

test('convenio: ni siquiera administración lo escribe por la API genérica', () => {
  const body = { texto: 'x', estado: 'aprobado' };
  assert.equal(writePlan({ path: 'convenios', id: '2027', method: 'PUT', user: ADMIN, body }).allow, false);
  assert.equal(writePlan({ path: 'convenios/2027/firmas', id: '12345678Z', method: 'PUT', user: ADMIN, body }).allow, false);
});

test('lectura propia: cada persona solo ve sus expedientes', () => {
  assert.equal(readPlan('aspirantes', PERSONA.dip, PERSONA).allow, true);
  assert.equal(readPlan('aspirantes', OTRA.dip, PERSONA).allow, false);
  assert.equal(readPlan(`aspirantes/${PERSONA.dip}/intentos`, null, PERSONA).allow, true);
  assert.equal(readPlan(`aspirantes/${OTRA.dip}/intentos`, null, PERSONA).allow, false);
  assert.equal(readPlan('keys', 'q1', PERSONA).allow, false, 'las respuestas correctas son solo de administración');
});

test('tablero: una persona puede coger una tarea libre de su proyecto', () => {
  const current = { projectId: 'p1', assignee: null, status: 'todo' };
  const d = writePlan({
    path: 'tasks', id: 't1', method: 'PATCH', user: PERSONA,
    body: { status: 'doing', assignee: PERSONA.dip },
    current, assignedProjects: ['p1'], taskProjectId: 'p1',
  });
  assert.equal(d.allow, true);
});

test('tablero: no puede coger tareas de proyectos ajenos ni de otra persona', () => {
  const libre = { projectId: 'p1', assignee: null };
  const ajena = { projectId: 'p1', assignee: OTRA.dip };
  const base = { path: 'tasks', id: 't1', method: 'PATCH', user: PERSONA, body: { status: 'doing', assignee: PERSONA.dip } };
  assert.equal(writePlan({ ...base, current: libre, assignedProjects: ['p2'], taskProjectId: 'p1' }).allow, false, 'proyecto no asignado');
  assert.equal(writePlan({ ...base, current: ajena, assignedProjects: ['p1'], taskProjectId: 'p1' }).allow, false, 'tarea de otra persona');
});

test('tablero: no puede cambiar campos distintos de estado y responsable', () => {
  const current = { projectId: 'p1', assignee: PERSONA.dip, title: 'x' };
  const d = writePlan({
    path: 'tasks', id: 't1', method: 'PATCH', user: PERSONA,
    body: { title: 'otro título' }, current, assignedProjects: ['p1'], taskProjectId: 'p1',
  });
  assert.equal(d.allow, false);
});

test('comentarios e incidencias: solo en nombre propio', () => {
  assert.equal(writePlan({ path: 'task_comments', id: 'c1', method: 'PUT', user: PERSONA, body: { authorId: PERSONA.dip, body: 'hola' } }).allow, true);
  assert.equal(writePlan({ path: 'task_comments', id: 'c1', method: 'PUT', user: PERSONA, body: { authorId: OTRA.dip, body: 'hola' } }).allow, false);
  assert.equal(writePlan({ path: 'incidents', id: 'i1', method: 'PUT', user: PERSONA, body: { by: PERSONA.dip, title: 'x' } }).allow, true);
  assert.equal(writePlan({ path: 'incidents', id: 'i1', method: 'PATCH', user: PERSONA, body: { status: 'resolved' }, current: { by: PERSONA.dip } }).allow, false, 'no puede resolver');
});

test('aceptación del convenio: solo el propio DIP (el recibo se valida en el endpoint)', () => {
  assert.equal(writePlan({ path: 'acceptances', id: PERSONA.dip, method: 'PUT', user: PERSONA, body: { text: 'x' } }).allow, true);
  assert.equal(writePlan({ path: 'acceptances', id: OTRA.dip, method: 'PUT', user: PERSONA, body: { text: 'x' } }).allow, false);
});

test('rol desconocido se trata como aspirante', () => {
  const raro = { id: 'u', dip: '87654321X', role: 'superadmin' };
  assert.equal(readPlan('convocatorias', null, raro).allow, true);
  assert.equal(writePlan({ path: 'settings', id: 'convenio', method: 'PUT', user: raro, body: { text: 'x' } }).allow, false);
});

test('calendario: solo a través de su endpoint, también para administración', () => {
  assert.equal(readPlan('calendario/2027/descansos', null, ADMIN).allow, false);
  assert.equal(readPlan('calendario/2027/descansos', null, PERSONA).allow, false);
  assert.equal(writePlan({ path: 'calendario/2027/actividades', id: 'a', method: 'PUT', user: ADMIN, body: { titulo: 'x' } }).allow, false);
});

test('capacidades por rol: lo que se muestra en la interfaz', async () => {
  const { capacidadesFor } = await import('../api/_permissions.js');
  const admin = capacidadesFor('administracion');
  const persona = capacidadesFor('aspirante');
  const pres = capacidadesFor('presidencia');
  assert.equal(admin.tareas.verTodas, true);
  assert.equal(persona.tareas.verTodas, false);
  assert.equal(admin.nominas.emitir, false, 'administración no emite nóminas');
  assert.equal(pres.nominas.emitir, true);
  assert.equal(pres.presidencia.auditoria, true);
  assert.equal(persona.presidencia.panel, false);
  assert.equal(persona.calendario.solicitarDescanso, true);
  assert.equal(persona.calendario.revisarDescansos, false);
});
