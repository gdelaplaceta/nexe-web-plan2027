import { requireUser, sendAuthError } from './_supabase.js';
import { PRIVACY_VERSION, TERMS_VERSION } from './_legal.js';
import { PRESIDENTE_DIP, isPresidentRole } from './_roles.js';
import { capacidadesFor } from './_permissions.js';

// Devuelve la persona de la sesión. Si la identidad es la de presidencia y
// todavía no tiene ese rol, lo asigna aquí, en el servidor, solo si ya aceptó
// la versión vigente de los textos legales.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { sb, user } = await requireUser(req);
    let role = user.role;

    if (user.dip === PRESIDENTE_DIP && !isPresidentRole(role)) {
      const { data: promoted, error } = await sb.from('nexe_profiles')
        .update({ rol: 'presidencia' })
        .eq('id', user.id)
        .eq('dip', PRESIDENTE_DIP)
        .eq('activo', true)
        .eq('terminos_version', TERMS_VERSION)
        .eq('privacidad_version', PRIVACY_VERSION)
        .select('rol')
        .maybeSingle();
      if (error) {
        console.error('[Nexe session] PRESIDENT_PROMOTION_FAILED', error.code || 'PROFILE_UPDATE_FAILED');
        return res.status(503).json({ error: 'president_setup_required' });
      }
      if (!promoted) return res.status(409).json({ error: 'president_legal_acceptance_required' });
      role = promoted.rol;
    }

    return res.status(200).json({
      authenticated: true,
      user: { id: user.dip, dip: user.dip, name: user.name, role, capacidades: capacidadesFor(role) },
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    console.error('[Nexe session] SESSION_LOOKUP_FAILED', error?.code || 'SESSION_LOOKUP_FAILED');
    return res.status(503).json({ error: 'session_unavailable' });
  }
}
