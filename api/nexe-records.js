import { requireUser } from './_supabase.js';

const allowed = new Set(['departments','projects','tasks','task_comments','calls','tests','call_tests','enrolments','attempts','agreements','payroll_complements']);

function validPath(value) {
  return typeof value === 'string'
    && value.length <= 240
    && /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(value)
    && value.split('/').length % 2 === 1;
}

function admin(user) {
  return user.role === 'presidencia' || user.role === 'administracion';
}

function canRead(path, user) {
  if (admin(user)) return true;
  const [root, id] = path.split('/');
  if (['convocatorias', 'questions'].includes(root)) return true;
  if (root === 'aspirantes' && id === user.dip) return true;
  if (['notas', 'res'].includes(root) && id === user.dip) return true;
  if (root === 'acceptances' && id === user.dip) return true;
  return false;
}

function canWrite(path, user) {
  if (admin(user)) return true;
  const segments = path.split('/');
  if (segments[0] !== 'aspirantes' || segments[1] !== user.dip) return false;
  return segments.length === 2 || ['inscripciones', 'intentos'].includes(segments[2]);
}

async function profileOwner(sb, path, user) {
  if (!admin(user)) return user.id;
  const [, dip] = path.split('/');
  if (!['aspirantes', 'notas', 'res', 'acceptances'].includes(path.split('/')[0]) || !dip) return user.id;
  const { data, error } = await sb.from('nexe_profiles').select('id').eq('dip', dip).maybeSingle();
  if (error) throw error;
  return data?.id || user.id;
}

async function handleDocumentApi(req, res, sb, user) {
  const path = String(req.query.path || '');
  const id = String(req.query.id || '');
  if (!validPath(path) || (id && !/^[a-zA-Z0-9_-]{1,160}$/.test(id))) {
    return res.status(400).json({ error: 'invalid_path' });
  }
  const collection = `nexe_documents`;
  if (req.method === 'GET') {
    if (!canRead(path, user)) return res.status(403).json({ error: 'forbidden' });
    let query = sb.from(collection).select('id,document_id,payload').eq('collection_path', path);
    if (!admin(user) && !['convocatorias', 'questions'].includes(path)) query = query.eq('owner_id', user.id);
    if (id) query = query.eq('document_id', id);
    const { data, error } = await query.order('created_at', { ascending: true });
    if (error) throw error;
    if (id) return res.status(200).json({ data: data[0] || null });
    return res.status(200).json({ data: data || [] });
  }

  if (req.method === 'PUT' || req.method === 'PATCH') {
    if (!id || !canWrite(path, user)) return res.status(id ? 403 : 400).json({ error: id ? 'forbidden' : 'document_id_required' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
      return res.status(400).json({ error: 'invalid_document' });
    }
    const ownerId = await profileOwner(sb, path, user);
    let payload = body.data;
    if (req.method === 'PATCH') {
      const current = await sb.from(collection).select('payload').eq('collection_path', path).eq('document_id', id).eq('owner_id', ownerId).maybeSingle();
      if (current.error) throw current.error;
      payload = { ...(current.data?.payload || {}), ...body.data };
    }
    const { data, error } = await sb.from(collection).upsert({
      collection_path: path,
      document_id: id,
      owner_id: ownerId,
      payload,
    }, { onConflict: 'collection_path,document_id' }).select('document_id,payload').single();
    if (error) throw error;
    return res.status(200).json({ data });
  }

  if (req.method === 'DELETE') {
    if (!id || !canWrite(path, user)) return res.status(id ? 403 : 400).json({ error: id ? 'forbidden' : 'document_id_required' });
    let query = sb.from(collection).delete().eq('collection_path', path).eq('document_id', id);
    if (!admin(user)) query = query.eq('owner_id', user.id);
    const { error } = await query;
    if (error) throw error;
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { sb, user } = await requireUser(req);
    if (req.query.path !== undefined) return await handleDocumentApi(req, res, sb, user);
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
