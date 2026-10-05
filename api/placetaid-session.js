import { requireUser } from './_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { user } = await requireUser(req);
    return res.status(200).json({
      authenticated: true,
      user: {
        id: user.dip,
        dip: user.dip,
        name: user.user_metadata?.name || user.dip,
        role: user.role,
      },
    });
  } catch (error) {
    if (['missing_session', 'invalid_session'].includes(error.message)) {
      return res.status(401).json({ authenticated: false });
    }
    console.error('[Nexe PlacetaID session] SESSION_LOOKUP_FAILED', error?.code || 'SESSION_LOOKUP_FAILED');
    return res.status(503).json({ error: 'session_unavailable' });
  }
}
