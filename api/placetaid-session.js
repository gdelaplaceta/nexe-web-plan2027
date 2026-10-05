import { requireUser } from './_supabase.js';
import { PRIVACY_VERSION, TERMS_VERSION } from './_legal.js';
import { PRESIDENTE_DIP } from './_roles.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { sb, user } = await requireUser(req);
    let role = user.role;
    if (user.dip === PRESIDENTE_DIP && role !== 'presidencia') {
      const { data: promotedProfile, error } = await sb.from('nexe_profiles')
        .update({ rol: 'presidencia' })
        .eq('id', user.id)
        .eq('dip', PRESIDENTE_DIP)
        .eq('activo', true)
        .eq('terminos_version', TERMS_VERSION)
        .eq('privacidad_version', PRIVACY_VERSION)
        .select('rol')
        .maybeSingle();
      if (error) {
        console.error('[Nexe PlacetaID session] PRESIDENT_PROMOTION_FAILED', error.code || 'PROFILE_UPDATE_FAILED');
        return res.status(503).json({ error: 'president_setup_required' });
      }
      if (!promotedProfile) return res.status(409).json({ error: 'president_legal_acceptance_required' });
      role = promotedProfile.rol;
    }
    return res.status(200).json({
      authenticated: true,
      user: {
        id: user.dip,
        dip: user.dip,
        name: user.user_metadata?.name || user.dip,
        role,
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
