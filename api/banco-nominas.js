// BFF Vercel: las credenciales del Banco nunca llegan al navegador.
// Configura BANCO_NOMINAS_URL y BANCO_CRM_KEY en Vercel.
export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  const target = process.env.BANCO_NOMINAS_URL;
  const key = process.env.BANCO_CRM_KEY;
  if (!target || !key) return res.status(503).json({ error: 'bank_not_configured' });
  try {
    const url = new URL(target);
    if (req.method === 'GET') Object.entries(req.query || {}).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const response = await fetch(url, {
      method: req.method,
      headers: { 'content-type': 'application/json', 'x-crm-key': key },
      body: req.method === 'POST' ? JSON.stringify(req.body || {}) : undefined
    });
    const text = await response.text();
    res.status(response.status).setHeader('content-type', response.headers.get('content-type') || 'application/json').send(text);
  } catch (error) { res.status(502).json({ error: 'bank_unreachable' }); }
}
