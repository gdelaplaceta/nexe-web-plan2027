// Roles de Nexe. Sin dependencias: testeable sin Supabase.
//
// Modelo:
//  - Toda persona activa es aspirante.
//  - Una plaza adjudicada en una convocatoria concede el rol que la convocatoria
//    indica en `rolConcedido` (por defecto, colaborador).
//  - Una persona puede tener varios roles a la vez (multirol).
//  - Presidencia no se concede por plaza: la identifica el DIP reservado.
//  - Un rol no reconocido se trata como aspirante (mínimo privilegio).
import { isDip } from './_security.js';

// DIP de presidencia. Puede sobrescribirse con NEXE_PRESIDENT_DIP. Si la variable
// no es válida se usa el valor histórico para no dejar la aplicación sin presidencia.
const DEFAULT_PRESIDENT_DIP = '23749931M';

export function presidentDip(env = process.env) {
  const configured = String(env.NEXE_PRESIDENT_DIP || '').trim().toUpperCase();
  return isDip(configured) ? configured : DEFAULT_PRESIDENT_DIP;
}

export const PRESIDENTE_DIP = presidentDip();

export const ROLES = Object.freeze([
  'presidencia',
  'administracion',
  'vicepresidencia',
  'secretaria',
  'direccion',
  'colaborador',
  'aspirante',
]);

// Roles que una convocatoria puede conceder al adjudicar una plaza.
// Presidencia no se concede así.
export const ROLES_CONCEDIBLES = Object.freeze([
  'colaborador', 'direccion', 'secretaria', 'vicepresidencia', 'administracion',
]);

const ADMIN_ROLES = new Set(['presidencia', 'administracion']);

export function normalizeRole(role) {
  return ROLES.includes(role) ? role : 'aspirante';
}

// Lista de roles de un usuario, aceptando la forma antigua (role) o la nueva (roles).
export function rolesOf(user) {
  if (Array.isArray(user?.roles)) return user.roles.map(normalizeRole);
  return user?.role ? [normalizeRole(user.role)] : ['aspirante'];
}

// Acepta un rol suelto o una lista.
export function isAdminRole(roles) {
  return [].concat(roles ?? []).some(r => ADMIN_ROLES.has(normalizeRole(r)));
}

export function isPresidentRole(roles) {
  return [].concat(roles ?? []).some(r => normalizeRole(r) === 'presidencia');
}

export function hasRole(roles, role) {
  return [].concat(roles ?? []).some(r => normalizeRole(r) === role);
}

// Rol principal para mostrar: el de mayor jerarquía.
export function primaryRole(roles) {
  const list = [].concat(roles ?? []).map(normalizeRole);
  return ROLES.find(r => list.includes(r)) || 'aspirante';
}

// Roles efectivos de una persona.
//   profileRol: rol guardado en su perfil (administración puede concederlo a mano).
//   plazaRoles: roles concedidos por plazas vigentes.
//   isPresident: si es el DIP reservado de presidencia.
export function effectiveRoles({ profileRol, plazaRoles = [], isPresident = false }) {
  const set = new Set(['aspirante']);
  if (profileRol && profileRol !== 'aspirante' && ROLES.includes(profileRol)) set.add(profileRol);
  for (const r of plazaRoles) if (ROLES_CONCEDIBLES.includes(r)) set.add(r);
  if (isPresident) set.add('presidencia');
  // Se devuelven ordenados por jerarquía para que el primero sea el principal.
  return ROLES.filter(r => set.has(r));
}

// Roles que concede cada plaza vigente.
//   resDocs: documentos notas/<dip>/res  ({document_id, payload:{estado}})
//   convDocs: documentos convocatorias   ({document_id, payload:{rolConcedido}})
// Una plaza cuya convocatoria ya no existe no concede nada.
export function rolesFromPlazas(resDocs, convDocs) {
  const conv = new Map(convDocs.map(c => [c.document_id, c.payload || {}]));
  const roles = [];
  for (const r of resDocs) {
    if (r.payload?.estado !== 'plaza') continue;
    const c = conv.get(r.document_id);
    if (!c) continue;
    const rol = ROLES_CONCEDIBLES.includes(c.rolConcedido) ? c.rolConcedido : 'colaborador';
    roles.push(rol);
  }
  return [...new Set(roles)];
}

// Colecciones compartidas por todas las personas activas (lectura).
export const SHARED_READ = new Set([
  'convocatorias', 'questions', 'orgs', 'projects', 'categories', 'settings',
  'members', 'assignments', 'tasks', 'task_comments',
]);

// Colecciones cuyos registros solo ve su propia persona.
export const OWN_SCOPED = new Set(['aspirantes', 'notas', 'res', 'acceptances']);

// Solo administración. Incluye las respuestas correctas de las pruebas.
export const ADMIN_ONLY = new Set(['keys']);

// Campos de una tarea que una persona puede cambiar sobre tareas de sus proyectos.
export const TASK_WORKER_FIELDS = Object.freeze(['status', 'assignee']);

// Estados válidos de una tarea (los que usa la interfaz).
export const TASK_STATUSES = Object.freeze(['todo', 'doing', 'review', 'approved']);
