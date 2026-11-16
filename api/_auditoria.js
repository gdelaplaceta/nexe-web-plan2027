// Formato del registro de auditoría. Sin dependencias: testeable sin Supabase.
import { isDip } from './_security.js';

const ACCIONES = {
  create: 'Alta', update: 'Modificación', delete: 'Baja', consent: 'Firma', login: 'Acceso', logout: 'Salida',
};

export function maskValue(value) {
  const text = String(value ?? '');
  return isDip(text) ? `••••${text.slice(-5)}` : text;
}

export function shapeRows(entries, profiles) {
  const byId = new Map(profiles.map(p => [p.id, p]));
  return entries.map(e => {
    const actor = byId.get(e.actor_id);
    return {
      id: e.id,
      fecha: e.created_at,
      persona: actor ? `${actor.nombre || 'Sin nombre'} · ${maskValue(actor.dip)}` : 'Sistema',
      accion: ACCIONES[e.action] || e.action,
      coleccion: e.collection_path || '—',
      documento: maskValue(e.document_id),
      ip: e.ip || '—',
    };
  });
}
