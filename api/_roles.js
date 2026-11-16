// Roles de Nexe y reglas de permiso. Sin dependencias para poder testearse.
//
// Principio: mínimo privilegio. Un rol nuevo o no reconocido se trata como
// `aspirante` hasta que se decida explícitamente qué puede hacer.
import { isDip } from './_security.js';

// DIP de presidencia. Puede sobrescribirse con NEXE_PRESIDENT_DIP para no
// depender de una constante en el código. Si la variable no es válida, se
// usa el valor histórico para no dejar la aplicación sin presidencia.
const DEFAULT_PRESIDENT_DIP = '23749931M';

export function presidentDip(env = process.env) {
  const configured = String(env.NEXE_PRESIDENT_DIP || '').trim().toUpperCase();
  return isDip(configured) ? configured : DEFAULT_PRESIDENT_DIP;
}

export const PRESIDENTE_DIP = presidentDip();

// Roles previstos en el documento de diseño. Los nuevos (colaborador,
// direccion, secretaria, vicepresidencia) se tratan como aspirante hasta
// que se definan sus permisos; ver docs/HOJA-DE-RUTA.md.
export const ROLES = Object.freeze([
  'aspirante',
  'colaborador',
  'direccion',
  'secretaria',
  'vicepresidencia',
  'administracion',
  'presidencia',
]);

const ADMIN_ROLES = new Set(['presidencia', 'administracion']);

export function normalizeRole(role) {
  return ROLES.includes(role) ? role : 'aspirante';
}

export function isAdminRole(role) {
  return ADMIN_ROLES.has(normalizeRole(role));
}

export function isPresidentRole(role) {
  return normalizeRole(role) === 'presidencia';
}

// Colecciones compartidas por todas las personas activas (lectura).
// Son datos internos necesarios para el tablero de tareas, el convenio y los
// proyectos. Lo que sea personal se filtra por persona en el servidor.
export const SHARED_READ = new Set([
  'convocatorias',
  'questions',
  'orgs',
  'projects',
  'categories',
  'settings',
  'members',
  'assignments',
  'tasks',
  'task_comments',
]);

// Colecciones cuyos registros solo ve su propia persona.
export const OWN_SCOPED = new Set(['aspirantes', 'notas', 'res', 'acceptances']);

// Solo administración. Incluye las respuestas correctas de las pruebas.
export const ADMIN_ONLY = new Set(['keys']);

// Campos de una tarea que una persona colaboradora puede cambiar sobre tareas
// de sus propios proyectos: coger una tarea, devolverla o avanzar su estado.
export const TASK_WORKER_FIELDS = Object.freeze(['status', 'assignee']);

// Estados válidos de una tarea (los que usa la interfaz).
export const TASK_STATUSES = Object.freeze(['todo', 'doing', 'review', 'approved']);
