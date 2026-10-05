import { requireUser } from './_supabase.js';

// BFF Vercel: las credenciales del Banco nunca llegan al navegador.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });

  let user;
  try {
    ({ user } = await requireUser(req));
  } catch (error) {
    if (['missing_session', 'invalid_session'].includes(error.message)) return res.status(401).json({ error: error.message });
    const code = String(error?.code || error?.message || '');
    console.error('[Nexe payroll] SESSION_LOOKUP_FAILED', code || 'SESSION_LOOKUP_FAILED');
    return res.status(503).json({ error: code === 'supabase_not_configured' ? code : 'session_unavailable' });
  }

  const isAdmin = user.role === 'presidencia' || user.role === 'administracion';
  if (req.method === 'POST' && !isAdmin) return res.status(403).json({ error: 'forbidden' });

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
    if (isAdmin) {
      Object.entries(req.query || {}).forEach(([k, v]) => {
        if (typeof v === 'string') url.searchParams.set(k, v);
      });
    } else {
      url.searchParams.set('action', 'estado');
      url.searchParams.set('employeeDip', user.dip);
      if (typeof req.query?.periodo === 'string') url.searchParams.set('periodo', req.query.periodo);
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
