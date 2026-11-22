import { requireUser, sendAuthError } from './_supabase.js';
import { capacidadesFor } from './_permissions.js';
import { primaryRole } from './_roles.js';

// Devuelve la persona de la sesión, sus roles y sus capacidades de interfaz.
// Los roles se calculan en el servidor (aspirante + plazas + presidencia por DIP).
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { user } = await requireUser(req);
    return res.status(200).json({
      authenticated: true,
      user: {
        id: user.dip,
        dip: user.dip,
        name: user.name,
        role: primaryRole(user.roles),
        roles: user.roles,
        capacidades: capacidadesFor(user.roles),
      },
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    console.error('[Nexe session] SESSION_LOOKUP_FAILED', error?.code || 'SESSION_LOOKUP_FAILED');
    return res.status(503).json({ error: 'session_unavailable' });
  }
}
