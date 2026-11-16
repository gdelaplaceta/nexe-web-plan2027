// Reglas de lectura y escritura de los documentos de Nexe.
// Funciones puras: reciben la persona, la ruta y los datos ya leídos, y
// devuelven una decisión. No tocan la base de datos, así que se testean solas.
import {
  ADMIN_ONLY, OWN_SCOPED, SHARED_READ, TASK_STATUSES, TASK_WORKER_FIELDS,
  isAdminRole, isPresidentRole,
} from './_roles.js';
import { isPlainObject } from './_security.js';

const SERVER_ONLY_ROOT = 'calendario';

// Qué puede hacer cada rol en la interfaz. El servidor lo calcula y lo envía en la sesión;
// la interfaz solo muestra pestañas y botones según esta respuesta. La autorización real
// la aplican siempre los endpoints.
export function capacidadesFor(role) {
  const admin = isAdminRole(role);
  const presidencia = isPresidentRole(role);
  return {
    convocatorias: { ver: true, gestionar: admin },
    expediente: { propio: true },
    convenio: { leer: true, firmar: true, publicar: admin },
    calendario: { leer: true, solicitarDescanso: true, gestionarActividades: admin, revisarDescansos: admin },
    organizacion: { equipo: admin, baremos: admin, incidenciasGestionar: admin },
    tareas: { tomar: true, verTodas: admin, gestionar: admin },
    incidencias: { declarar: true, gestionar: admin },
    nominas: { ver: true, gestionar: admin, emitir: presidencia },
    seleccion: { gestionar: admin },
    presidencia: { panel: presidencia, auditoria: presidencia },
  };
}

export function splitPath(path) {
  return String(path || '').split('/').filter(Boolean);
}

// Lectura. Devuelve { allow, filter } donde filter indica cómo acotar la
// consulta para una persona no administradora:
//   'none'        → sin filtro adicional
//   'document-id' → solo documentos cuyo id es su DIP (colecciones propias)
//   'incident-by' → solo incidencias declaradas por ella
//   'path'        → ruta que empieza por su DIP (p. ej. notas/<dip>/r)
export function readPlan(path, id, user) {
  const seg = splitPath(path);
  const root = seg[0];
  // Calendario y descansos: solo a través de /api/calendario (reglas y filtros allí).
  if (root === SERVER_ONLY_ROOT) return { allow: false };
  if (isAdminRole(user.role)) return { allow: true, filter: 'none' };
  if (!root || seg.length % 2 === 0) return { allow: false };

  // Convenio general: el texto y su estado los ve cualquier persona activa.
  // Firmantes y firmas (con DIP) solo administración; la API del convenio
  // los devuelve enmascarados.
  if (root === 'convenios') {
    if (seg.length === 1) return { allow: true, filter: 'none' };
    return { allow: false };
  }

  if (SHARED_READ.has(root) && seg.length === 1) return { allow: true, filter: 'none' };
  if (SHARED_READ.has(root) && seg.length > 1) return { allow: false };

  if (root === 'incidents' && seg.length === 1) return { allow: true, filter: 'incident-by' };

  if (OWN_SCOPED.has(root)) {
    if (seg.length === 1) {
      if (id && id !== user.dip) return { allow: false };
      return { allow: true, filter: 'document-id' };
    }
    if (seg[1] !== user.dip) return { allow: false };
    return { allow: true, filter: 'path' };
  }
  return { allow: false };
}

// Escritura (PUT = crear o reemplazar, PATCH = fusionar).
// `current`: documento actual (payload) o null si no existe.
// `assignedProjects`: proyectos de la persona (de su documento assignments).
// `taskProjectId`: proyecto de la tarea a la que se refiere la escritura.
export function writePlan({ path, id, method, user, body, current, assignedProjects = [], taskProjectId = null }) {
  const deny = { allow: false };
  if (!isPlainObject(body)) return deny;

  const seg = splitPath(path);
  const root = seg[0];
  const dip = user.dip;

  // El convenio solo cambia por su endpoint dedicado (publicación y firmas
  // verificadas). Ni siquiera administración lo escribe por la API genérica.
  if (root === 'convenios' || root === SERVER_ONLY_ROOT) return deny;

  if (isAdminRole(user.role)) return { allow: true };

  if (ADMIN_ONLY.has(root)) return deny;

  // Perfil propio, persona miembro y su convenio.
  if (seg.length === 1 && (root === 'aspirantes' || root === 'members' || root === 'acceptances')) {
    return id === dip ? { allow: true } : deny;
  }

  // Inscripciones e intentos de pruebas dentro de su propio expediente.
  if (seg.length === 3 && root === 'aspirantes' && seg[1] === dip
      && ['inscripciones', 'intentos'].includes(seg[2])) {
    return { allow: true };
  }

  // Comentarios de tareas: solo crear o editar los propios.
  if (seg.length === 1 && root === 'task_comments') {
    if (body.authorId !== dip) return deny;
    if (current && current.authorId !== dip) return deny;
    return { allow: true };
  }

  // Incidencias: solo declarar las propias; no se editan desde la cuenta.
  if (seg.length === 1 && root === 'incidents') {
    if (method !== 'PUT' && method !== 'POST') return deny;
    if (body.by !== dip) return deny;
    if (current) return deny;
    return { allow: true };
  }

  // Tareas: coger, devolver o avanzar tareas de sus propios proyectos.
  if (seg.length === 1 && root === 'tasks') {
    if (method !== 'PATCH' || !current) return deny;
    if (!assignedProjects.includes(taskProjectId)) return deny;
    const keys = Object.keys(body);
    if (!keys.length || keys.some(k => !TASK_WORKER_FIELDS.includes(k))) return deny;
    if ('status' in body && !TASK_STATUSES.includes(body.status)) return deny;
    if ('assignee' in body) {
      const next = body.assignee;
      const owner = current.assignee ?? null;
      const takingFree = owner === null && next === dip;
      const releasingOwn = owner === dip && next === null;
      const keepingOwn = owner === dip && next === dip;
      if (!(takingFree || releasingOwn || keepingOwn)) return deny;
    } else if (current.assignee !== dip) {
      return deny;
    }
    return { allow: true };
  }

  return deny;
}

export function visibleRow(row, plan, user) {
  if (plan.filter === 'none') return true;
  if (plan.filter === 'document-id') return row.document_id === user.dip;
  if (plan.filter === 'incident-by') return row.payload?.by === user.dip;
  if (plan.filter === 'path') return row.collection_path?.split('/')[1] === user.dip;
  return false;
}
