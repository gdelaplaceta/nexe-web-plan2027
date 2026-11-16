import { requireSameOrigin } from './_supabase.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    requireSameOrigin(req);
  } catch {
    return res.status(403).json({ error: 'forbidden_origin' });
  }
  res.setHeader('Set-Cookie', [
    'nexe_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    'nexe_registration=; HttpOnly; Secure; SameSite=Lax; Path=/api/placetaid-register; Max-Age=0',
  ]);
  return res.redirect(303, '/');
}
