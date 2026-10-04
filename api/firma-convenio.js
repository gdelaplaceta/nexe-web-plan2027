// Metadatos emitidos por Vercel para una firma. La IP se obtiene del request,
// nunca del navegador. La persistencia final debe hacerse en Supabase/RSP.
export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const forwarded = req.headers['x-forwarded-for'];
  const ip = String(forwarded || req.socket?.remoteAddress || '').split(',')[0].trim();
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ip: ip || 'no-disponible', signedAt: new Date().toISOString() });
}
