// Roles multirol calculados desde plazas: `node --test test/roles.test.js`
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  effectiveRoles, rolesFromPlazas, primaryRole, isAdminRole, isPresidentRole, rolesOf,
  ROLES_CONCEDIBLES,
} from '../api/_roles.js';
import { capacidadesFor, writePlan } from '../api/_permissions.js';

const CONV = [
  { document_id: 'c-admin', payload: { titulo: 'Administrativo/a', rolConcedido: 'administracion' } },
  { document_id: 'c-sec', payload: { titulo: 'Secretaría', rolConcedido: 'secretaria' } },
  { document_id: 'c-base', payload: { titulo: 'Colaboración general' } },
];
const res = (id, estado) => ({ collection_path: 'notas/12345678Z/res', document_id: id, payload: { estado } });

test('toda persona es aspirante sin plazas', () => {
  assert.deepEqual(effectiveRoles({ profileRol: 'aspirante', plazaRoles: [] }), ['aspirante']);
});

test('una plaza concede su rol y se mantiene el de aspirante', () => {
  const roles = effectiveRoles({ plazaRoles: rolesFromPlazas([res('c-sec', 'plaza')], CONV) });
  assert.deepEqual(roles, ['secretaria', 'aspirante']);
  assert.equal(primaryRole(roles), 'secretaria');
});

test('varias plazas dan varios roles a la vez (multirol)', () => {
  const roles = effectiveRoles({
    plazaRoles: rolesFromPlazas([res('c-admin', 'plaza'), res('c-sec', 'plaza'), res('c-base', 'plaza')], CONV),
  });
  assert.deepEqual(roles, ['administracion', 'secretaria', 'colaborador', 'aspirante']);
  assert.equal(primaryRole(roles), 'administracion', 'el principal es el de mayor jerarquía');
});

test('reserva y exclusión no conceden roles', () => {
  assert.deepEqual(rolesFromPlazas([res('c-admin', 'reserva'), res('c-sec', 'excluida')], CONV), []);
});

test('quitar la plaza retira el rol (revocación inmediata)', () => {
  assert.deepEqual(rolesFromPlazas([res('c-sec', 'plaza')], CONV), ['secretaria']);
  assert.deepEqual(rolesFromPlazas([res('c-sec', 'excluida')], CONV), []);
});

test('una convocatoria que concede presidencia no la concede: cae a colaborador', () => {
  const conv = [{ document_id: 'x', payload: { rolConcedido: 'presidencia' } }];
  assert.deepEqual(rolesFromPlazas([{ collection_path: 'notas/1/res', document_id: 'x', payload: { estado: 'plaza' } }], conv), ['colaborador']);
  assert.equal(ROLES_CONCEDIBLES.includes('presidencia'), false);
});

test('una plaza cuya convocatoria ya no existe no concede nada', () => {
  assert.deepEqual(rolesFromPlazas([res('borrada', 'plaza')], CONV), []);
});

test('presidencia solo por DIP reservado, y nunca por plaza', () => {
  assert.deepEqual(effectiveRoles({ profileRol: 'aspirante', plazaRoles: ['administracion'], isPresident: true }), ['presidencia', 'administracion', 'aspirante']);
  assert.equal(effectiveRoles({ profileRol: 'aspirante', plazaRoles: ['administracion'], isPresident: false }).includes('presidencia'), false);
});

test('la administración de un rol antiguo (string) sigue funcionando', () => {
  assert.equal(isAdminRole('administracion'), true);
  assert.equal(isAdminRole(['colaborador', 'administracion']), true);
  assert.equal(isAdminRole(['colaborador', 'secretaria']), false);
  assert.equal(isPresidentRole(['presidencia']), true);
  assert.deepEqual(rolesOf({ role: 'administracion' }), ['administracion']);
  assert.deepEqual(rolesOf({ roles: ['colaborador', 'direccion'] }), ['colaborador', 'direccion']);
});

test('capacidades: la unión de los roles de la persona', () => {
  const c = capacidadesFor(['secretaria', 'direccion', 'aspirante']);
  assert.equal(c.actas.redactar, true);
  assert.equal(c.departamento.gestionar, true);
  assert.equal(c.presidencia.archivo, false);
  assert.equal(c.nominas.emitir, false);
  assert.equal(capacidadesFor(['presidencia']).presidencia.archivo, true);
});

test('una convocatoria no puede conceder presidencia ni roles inventados', () => {
  const base = { collection_path: 'convocatorias', id: 'c1', method: 'PUT', user: { id: 'a', dip: '12345678Z', roles: ['administracion', 'aspirante'] } };
  assert.equal(writePlan({ ...base, body: { titulo: 'x', rolConcedido: 'presidencia' }, path: 'convocatorias' }).allow, false);
  assert.equal(writePlan({ ...base, body: { titulo: 'x', rolConcedido: 'superadmin' }, path: 'convocatorias' }).allow, false);
  assert.equal(writePlan({ ...base, body: { titulo: 'x', rolConcedido: 'secretaria' }, path: 'convocatorias' }).allow, true);
});
