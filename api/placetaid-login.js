import crypto from 'node:crypto';
const redirect = () => process.env.PLACETAID_REDIRECT_URI || 'https://nexe-web-plan2027.vercel.app/auth/callback';
export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const base = process.env.PLACETAID_URL;
  const clientId = process.env.PLACETAID_CLIENT_ID;
  const secret = process.env.NEXE_SESSION_SECRET;
  if (!base || !clientId || !secret) return res.status(503).json({ error: 'placetaid_not_configured' });
  const state = crypto.randomBytes(24).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(state).digest('base64url');
  res.setHeader('Set-Cookie', `nexe_oauth_state=${state}.${sig}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  const url = new URL('/api/auth/fase1', base);
  url.searchParams.set('from', redirect()); url.searchParams.set('client_id', clientId); url.searchParams.set('state', state); url.searchParams.set('platform', 'web'); url.searchParams.set('service', 'Nexe');
  res.redirect(url.toString());
}
