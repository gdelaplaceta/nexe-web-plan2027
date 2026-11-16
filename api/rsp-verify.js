import { requireUser, requireSameOrigin, sendAuthError, serverSupabase } from './_supabase.js';
import { isDip } from './_security.js';

// Verificación del DIP frente al registro oficial (RSP). Solo para la persona
// con sesión, solo para su propio DIP y sin devolver detalles del proveedor.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const session = await requireUser(req);
    requireSameOrigin(req);
    const { user } = session;
    const sb = session.sb || serverSupabase();
    const dip = String(req.body?.dip || '').toUpperCase().replace(/[ -]/g, '');
    if (!isDip(dip) || dip !== user.dip) return res.status(400).json({ error: 'invalid_dip' });

    const rsp = process.env.RSP_VERIFY_URL;
    if (!rsp || !process.env.RSP_API_KEY) return res.status(503).json({ error: 'rsp_not_configured' });

    let upstream;
    try {
      upstream = await fetch(rsp, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.RSP_API_KEY}` },
        body: JSON.stringify({ dip }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      console.error('[Nexe RSP] UPSTREAM_UNAVAILABLE', error?.name || 'FETCH_FAILED');
      return res.status(503).json({ error: 'rsp_unavailable' });
    }
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok || result.verified !== true) return res.status(403).json({ error: 'dip_not_verified' });

    const { error } = await sb.from('nexe_profiles')
      .update({ rsp_verificado: true, rsp_verificado_at: new Date().toISOString() })
      .eq('id', user.id);
    if (error) throw error;
    return res.status(200).json({ verified: true, dip });
  } catch (error) {
    if (error?.status === 403) return res.status(403).json({ error: 'forbidden_origin' });
    if (sendAuthError(res, error)) return;
    console.error('[Nexe RSP] VERIFY_FAILED', error?.code || 'VERIFY_FAILED');
    return res.status(503).json({ error: 'verification_unavailable' });
  }
}
