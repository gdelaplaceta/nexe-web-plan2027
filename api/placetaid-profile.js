import { requireUser } from './_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const { sb, user } = await requireUser(req);
    const url = process.env.PLACETAID_V27_PROFILE_URL;
    if (!url || !process.env.PLACETAID_V27_API_KEY) return res.status(503).json({ error: 'placetaid_not_configured' });
    const upstream = await fetch(`${url}?user_id=${encodeURIComponent(user.id)}`, { headers: { authorization: `Bearer ${process.env.PLACETAID_V27_API_KEY}` } });
    const profile = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'placetaid_profile_unavailable' });
    const safe = { nombre: profile.nombre || profile.name || '', dip: profile.dip || '', email: profile.email || '', avatar_url: profile.avatar_url || null, placeid: profile.placeid || profile.placetaId || null };
    await sb.from('nexe_profiles').upsert({ id: user.id, nombre: safe.nombre || safe.dip, dip: safe.dip, datos_placetaid: safe, placetaid_synced_at: new Date().toISOString() });
    return res.status(200).json({ profile: safe });
  } catch (e) { return res.status(503).json({ error: e.message }); }
}
