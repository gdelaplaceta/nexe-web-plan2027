// Registro de auditoría para presidencia. Solo lectura, con datos enmascarados.
// GET /api/auditoria?limite=100
import { requireUser, sendAuthError, serverSupabase } from './_supabase.js';
import { isPresidentRole, rolesOf } from './_roles.js';
import { shapeRows } from './_auditoria.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const { sb, user } = await requireUser(req);
    if (!isPresidentRole(rolesOf(user))) return res.status(403).json({ error: 'forbidden' });

    const limite = Math.min(200, Math.max(1, Number(req.query.limite) || 100));
    const { data: entries, error } = await sb.from('nexe_audit_log')
      .select('id,created_at,actor_id,action,collection_path,document_id,ip')
      .order('created_at', { ascending: false })
      .limit(limite);
    if (error) throw error;

    const ids = [...new Set((entries || []).map(e => e.actor_id).filter(Boolean))];
    let profiles = [];
    if (ids.length) {
      const { data, error: pErr } = await sb.from('nexe_profiles').select('id,dip,nombre').in('id', ids);
      if (pErr) throw pErr;
      profiles = data || [];
    }
    return res.status(200).json({ data: shapeRows(entries || [], profiles) });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    console.error('[Nexe auditoria] REQUEST_FAILED', error?.code || 'AUDIT_UNAVAILABLE');
    return res.status(503).json({ error: 'auditoria_unavailable' });
  }
}
