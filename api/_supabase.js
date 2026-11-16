import { createClient } from '@supabase/supabase-js';
import { verifySession, sameOrigin, clientIp } from './_security.js';
import { normalizeRole } from './_roles.js';

// Cliente de Supabase solo para el servidor. La clave secreta nunca llega al navegador.
export function serverSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('supabase_not_configured');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function cookie(req, name) {
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return '';
}

// Resuelve la persona autenticada a partir de la cookie de sesión firmada
// por Nexe y su perfil activo en Supabase. Lanza 'missing_session' o
// 'invalid_session' si no hay sesión válida.
export async function requireUser(req) {
  const sb = serverSupabase();
  const session = verifySession(cookie(req, 'nexe_session'), process.env.NEXE_SESSION_SECRET);
  if (!session) throw new Error(cookie(req, 'nexe_session') ? 'invalid_session' : 'missing_session');

  const { data: profile, error } = await sb.from('nexe_profiles')
    .select('id,dip,nombre,rol,activo')
    .eq('dip', session.dip)
    .maybeSingle();
  if (error) throw error;
  if (!profile || !profile.activo) throw new Error('invalid_session');

  return {
    sb,
    ip: clientIp(req),
    user: {
      id: profile.id,
      dip: profile.dip,
      name: profile.nombre || profile.dip,
      role: normalizeRole(profile.rol),
    },
  };
}

// Las escrituras que usan cookie de sesión deben venir del mismo sitio.
// SameSite=Lax ya bloquea la mayoría de los ataques CSRF; esta comprobación
// es una segunda barrera y protege también si la política de cookies cambia.
export function requireSameOrigin(req) {
  if (!sameOrigin(req)) {
    const error = new Error('forbidden_origin');
    error.status = 403;
    throw error;
  }
}

// Respuesta de error genérica: nunca se devuelven detalles internos al cliente.
export function sendAuthError(res, error) {
  if (['missing_session', 'invalid_session'].includes(error?.message)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(401).json({ error: error.message });
    return true;
  }
  return false;
}
