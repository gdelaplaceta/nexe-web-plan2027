import { createClient } from '@supabase/supabase-js';

export function serverSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('supabase_not_configured');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function bearer(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

export function cookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return '';
}

export async function requireUser(req) {
  const token = bearer(req);
  const sb = serverSupabase();
  if (!token) {
    const raw = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('nexe_session='))?.slice(13) || '';
    const [payload, signature] = raw.split('.');
    const secret = process.env.NEXE_SESSION_SECRET || '';
    const expected = secret && payload ? (await import('node:crypto')).createHmac('sha256', secret).update(payload).digest('base64url') : '';
    if (!payload || !signature || signature !== expected) throw new Error('missing_session');
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!session.dip || Date.now() - Number(session.iat || 0) > 8 * 60 * 60 * 1000) throw new Error('invalid_session');
    const { data: profile } = await sb.from('nexe_profiles').select('id,dip,nombre,rol').eq('dip', session.dip).maybeSingle();
    if (!profile) throw new Error('profile_not_registered');
    return { sb, user: { id: profile.id, dip: profile.dip, user_metadata: { name: profile.nombre }, role: profile.rol } };
  }
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) throw new Error('invalid_session');
  return { sb, user: data.user };
}
