export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('Set-Cookie', [
    'nexe_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    'nexe_registration=; HttpOnly; Secure; SameSite=Lax; Path=/api/placetaid-register; Max-Age=0',
  ]);
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(303, '/');
}
