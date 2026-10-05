import { requireUser } from './_supabase.js';

const allowed = new Set(['departments','projects','tasks','task_comments','calls','tests','call_tests','enrolments','attempts','agreements','payroll_complements']);
export default async function handler(req, res) {
  try {
    const { sb, user } = await requireUser(req);
    const table = String(req.query.table || '');
    if (!allowed.has(table)) return res.status(400).json({ error: 'invalid_table' });
    if (req.method === 'GET') {
      let query = sb.from(`nexe_${table}`).select('*').order('created_at', { ascending: false });
      if (user.role !== 'presidencia') query = query.eq('owner_id', user.id);
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ data });
    }
    if (req.method === 'POST') {
      const payload = { owner_id: user.id, payload: req.body || {} };
      const { data, error } = await sb.from(`nexe_${table}`).insert(payload).select('*').single();
      if (error) throw error;
      return res.status(201).json({ data });
    }
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) { return res.status(e.message === 'missing_session' || e.message === 'invalid_session' ? 401 : 503).json({ error: e.message }); }
}
