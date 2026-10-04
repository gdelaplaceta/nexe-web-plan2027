import { requireUser } from './_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const { sb, user } = await requireUser(req);
    const dip = String(req.body?.dip || '').toUpperCase().replace(/[ -]/g, '');
    if (!/^([0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z])$/.test(dip)) return res.status(400).json({ error: 'invalid_dip' });
    const rsp = process.env.RSP_VERIFY_URL;
    if (!rsp || !process.env.RSP_API_KEY) return res.status(503).json({ error: 'rsp_not_configured' });
    const upstream = await fetch(rsp, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.RSP_API_KEY}` }, body: JSON.stringify({ dip }) });
    const result = await upstream.json();
    if (!upstream.ok || !result.verified) return res.status(403).json({ error: 'dip_not_verified' });
    const { error } = await sb.from('nexe_profiles').upsert({ id: user.id, dip, nombre: result.nombre || user.user_metadata?.name || dip, rsp_verificado: true, rsp_verificado_at: new Date().toISOString() });
    if (error) throw error;
    return res.status(200).json({ verified: true, dip, nombre: result.nombre || dip });
  } catch (e) { return res.status(503).json({ error: e.message }); }
}
