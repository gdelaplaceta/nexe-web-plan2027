// API de documentos y registros de Nexe.
// - Lectura: filtrada por persona según api/_permissions.js.
// - Escritura: validada, con comprobación de origen y auditoría atómica
//   (la función SQL escribe el dato y su entrada de auditoría en una transacción).
import { requireUser, requireSameOrigin, sendAuthError, serverSupabase } from './_supabase.js';
import { readPlan, writePlan, visibleRow, splitPath } from './_permissions.js';
import { isAdminRole } from './_roles.js';
import { MAX_JSON_BYTES, isPlainObject, jsonSize, verifyReceipt } from './_security.js';

const TABLES = new Set([
  'departments', 'projects', 'tasks', 'task_comments', 'calls', 'tests',
  'call_tests', 'enrolments', 'attempts', 'agreements', 'payroll_complements',
]);

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,160}$/;
const PATH_PATTERN = /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/;

function validPath(value) {
  return typeof value === 'string'
    && value.length <= 240
    && PATH_PATTERN.test(value)
    && splitPath(value).length % 2 === 1;
}

function fail(res, status, error) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ error });
}

// Recibo del convenio: se valida aquí, en el servidor, y no en el navegador.
async function checkAcceptance(body, user) {
  const payload = body.data;
  if (typeof payload.text !== 'string' || !payload.text) return 'acceptance_text_required';
  if (!verifyReceipt(payload.receipt, { dip: user.dip, text: payload.text }, process.env.NEXE_SESSION_SECRET)) {
    return 'acceptance_receipt_invalid';
  }
  // La fecha y la IP las fija el recibo firmado, no el cliente.
  payload.acceptedAt = payload.receipt.signedAt;
  payload.ip = payload.receipt.ip;
  payload.signerDip = user.dip;
  return null;
}

async function currentDocument(sb, path, id) {
  const { data, error } = await sb.from('nexe_documents')
    .select('owner_id,payload')
    .eq('collection_path', path)
    .eq('document_id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function taskContext(sb, user, path, id) {
  if (path !== 'tasks') return { assignedProjects: [], taskProjectId: null, current: null };
  const current = await currentDocument(sb, 'tasks', id);
  const { data: assignment, error } = await sb.from('nexe_documents')
    .select('payload')
    .eq('collection_path', 'assignments')
    .eq('document_id', user.dip)
    .maybeSingle();
  if (error) throw error;
  return {
    assignedProjects: assignment?.payload?.projectIds || [],
    taskProjectId: current?.payload?.projectId ?? null,
    current: current?.payload ?? null,
  };
}

async function profileIdForDip(sb, dip) {
  const { data, error } = await sb.from('nexe_profiles').select('id').eq('dip', dip).maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

async function handleDocument(req, res, sb, user, ip) {
  const path = String(req.query.path || '');
  const id = String(req.query.id || '');
  if (!validPath(path) || (id && !ID_PATTERN.test(id))) return fail(res, 400, 'invalid_path');

  if (req.method === 'GET') {
    const plan = readPlan(path, id, user);
    if (!plan.allow) return fail(res, 403, 'forbidden');
    let query = sb.from('nexe_documents').select('id,document_id,payload,collection_path').eq('collection_path', path);
    if (id) query = query.eq('document_id', id);
    const { data, error } = await query.order('created_at', { ascending: true });
    if (error) throw error;
    const rows = (data || []).filter(row => visibleRow(row, plan, user)).map(({ collection_path, ...row }) => row);
    if (id) return res.status(200).json({ data: rows[0] || null });
    return res.status(200).json({ data: rows });
  }

  if (req.method === 'PUT' || req.method === 'PATCH') {
    if (!id) return fail(res, 400, 'document_id_required');
    const body = req.body;
    if (!isPlainObject(body) || !isPlainObject(body.data)) return fail(res, 400, 'invalid_document');
    if (jsonSize(body.data) > MAX_JSON_BYTES) return fail(res, 413, 'document_too_large');

    const ctx = await taskContext(sb, user, path, id);
    const current = path === 'tasks' ? { payload: ctx.current } : await currentDocument(sb, path, id);
    const decision = writePlan({
      path, id, method: req.method, user, body: body.data,
      current: current?.payload ?? null,
      assignedProjects: ctx.assignedProjects,
      taskProjectId: ctx.taskProjectId,
    });
    if (!decision.allow) return fail(res, 403, 'forbidden');

    if (path === 'acceptances') {
      const error = await checkAcceptance(body, user);
      if (error) return fail(res, 400, error);
    }

    // Propietaria: la persona misma, o el perfil de la persona afectada
    // cuando administración escribe en su expediente.
    let ownerId = user.id;
    const seg = splitPath(path);
    if (isAdminRole(user.role) && ['aspirantes', 'notas', 'res', 'acceptances', 'members'].includes(seg[0])) {
      ownerId = (await profileIdForDip(sb, id)) || user.id;
    }

    const { data, error } = await sb.rpc('nexe_save_document', {
      p_collection: path,
      p_document_id: id,
      p_owner: ownerId,
      p_actor: user.id,
      p_payload: body.data,
      p_merge: req.method === 'PATCH',
      p_ip: ip,
    });
    if (error) throw error;
    return res.status(200).json({ data: { document_id: data.document_id, payload: data.payload } });
  }

  if (req.method === 'DELETE') {
    if (!id) return fail(res, 400, 'document_id_required');
    if (!isAdminRole(user.role)) return fail(res, 403, 'forbidden');
    const { data, error } = await sb.rpc('nexe_delete_document', {
      p_collection: path, p_document_id: id, p_actor: user.id, p_ip: ip,
    });
    if (error) throw error;
    return res.status(200).json({ ok: data === true });
  }

  return fail(res, 405, 'method_not_allowed');
}

async function handleTable(req, res, sb, user, ip) {
  const table = String(req.query.table || '');
  if (!TABLES.has(table)) return fail(res, 400, 'invalid_table');

  if (req.method === 'GET') {
    let query = sb.from(`nexe_${table}`).select('*').order('created_at', { ascending: false });
    if (!isAdminRole(user.role)) query = query.eq('owner_id', user.id);
    const { data, error } = await query;
    if (error) throw error;
    return res.status(200).json({ data });
  }

  if (req.method === 'POST') {
    if (!isPlainObject(req.body)) return fail(res, 400, 'invalid_record');
    if (jsonSize(req.body) > MAX_JSON_BYTES) return fail(res, 413, 'record_too_large');
    const { data, error } = await sb.rpc('nexe_insert_record', {
      p_table: table, p_owner: user.id, p_actor: user.id, p_payload: req.body, p_ip: ip,
    });
    if (error) throw error;
    return res.status(201).json({ data });
  }

  return fail(res, 405, 'method_not_allowed');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const mutating = !['GET', 'HEAD'].includes(req.method);
  let session;
  try {
    session = await requireUser(req);
    if (mutating) requireSameOrigin(req);
  } catch (error) {
    if (error?.status === 403) return fail(res, 403, 'forbidden_origin');
    if (sendAuthError(res, error)) return;
    console.error('[Nexe records] REQUEST_FAILED', error?.code || 'SESSION_UNAVAILABLE');
    return fail(res, 503, 'records_unavailable');
  }

  const { user, ip } = session;
  const sb = session.sb;
  try {
    if (req.query.path !== undefined) return await handleDocument(req, res, sb, user, ip);
    return await handleTable(req, res, sb, user, ip);
  } catch (error) {
    const code = String(error?.code || '');
    if (['42P01', 'PGRST205', '42883'].includes(code)) {
      console.error('[Nexe records] DOCUMENT_SCHEMA_MISSING', code);
      return fail(res, 503, 'database_schema_missing');
    }
    console.error('[Nexe records] REQUEST_FAILED', code || 'RECORDS_UNAVAILABLE');
    return fail(res, 503, 'records_unavailable');
  }
}
