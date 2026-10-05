import { requireUser } from './_supabase.js';

// BFF Vercel: las credenciales del Banco nunca llegan al navegador.
async function hasAwardedPlace(sb, user) {
  const { data, error } = await sb.from('nexe_documents')
    .select('payload')
    .eq('collection_path', `notas/${user.dip}/res`)
    .eq('owner_id', user.id);
  if (error) throw error;
  return (data || []).some(row => row.payload?.estado === 'plaza');
}

async function hasAwardedPlaceOrUnavailable(sb, user, res) {
  try {
    return await hasAwardedPlace(sb, user);
  } catch (error) {
    console.error('[Nexe payroll] PLACE_LOOKUP_FAILED', error?.code || 'PLACE_LOOKUP_FAILED');
    res.status(503).json({ error: 'session_unavailable' });
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });

  let sb;
  let user;
  try {
    ({ sb, user } = await requireUser(req));
  } catch (error) {
    if (['missing_session', 'invalid_session'].includes(error.message)) return res.status(401).json({ error: error.message });
    const code = String(error?.code || error?.message || '');
    console.error('[Nexe payroll] SESSION_LOOKUP_FAILED', code || 'SESSION_LOOKUP_FAILED');
    return res.status(503).json({ error: code === 'supabase_not_configured' ? code : 'session_unavailable' });
  }

  const isPresident = user.role === 'presidencia';
  const isAdmin = isPresident || user.role === 'administracion';

  const bankUrl = process.env.BANCO_API_URL || process.env.BANK_URL || 'https://api.banco.laplaceta.org';
  const target = process.env.BANCO_NOMINAS_URL || `${bankUrl.replace(/\/+$/, '')}/api/nominas`;
  const key = process.env.BANCO_CRM_KEY || process.env.CRM_READ_KEY || process.env.BANK_CRM_KEY;
  if (!key) return res.status(503).json({ error: 'bank_not_configured' });

  let url;
  try {
    url = new URL(target);
    if (url.protocol !== 'https:') return res.status(503).json({ error: 'bank_url_invalid' });
  } catch {
    return res.status(503).json({ error: 'bank_url_invalid' });
  }
  if (req.method === 'GET') {
    const action = typeof req.query?.action === 'string' ? req.query.action : 'estado';
    if (isAdmin) {
      Object.entries(req.query || {}).forEach(([k, v]) => {
        if (typeof v === 'string') url.searchParams.set(k, v);
      });
    } else if (action === 'cuentas') {
      const employeeDip = typeof req.query?.employeeDip === 'string' ? req.query.employeeDip.toUpperCase() : user.dip;
      if (employeeDip !== user.dip) return res.status(403).json({ error: 'forbidden' });
      const hasPlace = await hasAwardedPlaceOrUnavailable(sb, user, res);
      if (hasPlace === null) return;
      if (!hasPlace) {
        return res.status(403).json({ error: 'forbidden' });
      }
      url.searchParams.set('action', 'cuentas');
      url.searchParams.set('employeeDip', user.dip);
    } else {
      url.searchParams.set('action', 'estado');
      url.searchParams.set('employeeDip', user.dip);
      if (typeof req.query?.periodo === 'string') url.searchParams.set('periodo', req.query.periodo);
    }
  } else {
    const requestHost = String(req.headers.host || '').toLowerCase();
    let originHost = '';
    try {
      originHost = new URL(String(req.headers.origin || '')).host.toLowerCase();
    } catch {
      return res.status(403).json({ error: 'invalid_origin' });
    }
    if (!requestHost || originHost !== requestHost) return res.status(403).json({ error: 'invalid_origin' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.action === 'config') {
      if (!isAdmin) return res.status(403).json({ error: 'forbidden' });
    } else if (body.action === 'cerrar') {
      if (!isPresident || body.pagar !== true) return res.status(403).json({ error: 'forbidden' });
      if (typeof body.periodo !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.periodo)) {
        return res.status(400).json({ error: 'invalid_period' });
      }
      req.body = { action: 'cerrar', periodo: body.periodo, pagar: true, autor: user.dip };
    } else if (body.action === 'cuenta-trabajador') {
      const employeeDip = String(body.employeeDip || '').trim().toUpperCase();
      if (!employeeDip) return res.status(400).json({ error: 'employee_required' });
      if (!isAdmin) {
        if (employeeDip !== user.dip) return res.status(403).json({ error: 'forbidden' });
        const hasPlace = await hasAwardedPlaceOrUnavailable(sb, user, res);
        if (hasPlace === null) return;
        if (!hasPlace) return res.status(403).json({ error: 'forbidden' });
      }
      req.body = {
        action: 'cuenta-trabajador',
        employeeDip,
        employeeAccountId: String(body.employeeAccountId || ''),
        autor: user.dip,
      };
    } else {
      return res.status(400).json({ error: 'unsupported_action' });
    }
  }

  let response;
  try {
    response = await fetch(url, {
      method: req.method,
      headers: { 'content-type': 'application/json', 'x-crm-key': key },
      body: req.method === 'POST' ? JSON.stringify(req.body || {}) : undefined
    });
  } catch (error) {
    console.error('[Nexe payroll] BANK_CONNECTION_FAILED', error?.cause?.code || error?.code || 'FETCH_FAILED');
    return res.status(502).json({ error: 'bank_unreachable' });
  }
  const text = await response.text();
  if (!response.ok) console.error('[Nexe payroll] BANK_UPSTREAM_REJECTED', response.status);
  return res.status(response.status).setHeader('content-type', response.headers.get('content-type') || 'application/json').send(text);
}
