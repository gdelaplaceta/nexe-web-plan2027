import crypto from 'node:crypto';
import { cookie, serverSupabase } from './_supabase.js';

const redirectUri = () => process.env.PLACETAID_REDIRECT_URI || 'https://nexe-web-plan2027.vercel.app/auth/callback';

function placetaidOrigin() {
  const configured = String(process.env.PLACETAID_URL || '').trim();
  if (!configured) throw new Error('PLACETAID_URL_NOT_CONFIGURED');
  const url = new URL(configured.includes('://') ? configured : `https://${configured}`);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('PLACETAID_URL_INVALID');
  }
  return url.origin;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function clearStateCookie(res) {
  res.setHeader('Set-Cookie', 'nexe_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const sessionSecret = String(process.env.NEXE_SESSION_SECRET || '');
  const receivedState = String(req.query.state || '');
  const code = String(req.query.code || '');
  const storedState = cookie(req, 'nexe_oauth_state');
  const [expectedState, stateSignature] = storedState.split('.');
  if (sessionSecret.length < 32 || !expectedState || !stateSignature || !receivedState || !safeEqual(receivedState, expectedState)) {
    clearStateCookie(res);
    return res.status(403).send('Estado OAuth inválido');
  }
  const expectedSignature = crypto.createHmac('sha256', sessionSecret).update(receivedState).digest('base64url');
  if (!safeEqual(stateSignature, expectedSignature)) {
    clearStateCookie(res);
    return res.status(403).send('Estado OAuth inválido');
  }
  if (req.query.error) {
    clearStateCookie(res);
    return res.status(403).send('Autenticación cancelada');
  }
  if (!code) {
    clearStateCookie(res);
    return res.status(400).send('PlacetaID no devolvió un código de autorización');
  }

  const clientId = String(process.env.PLACETAID_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.PLACETAID_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    clearStateCookie(res);
    return res.status(503).send('La integración de PlacetaID no está configurada');
  }

  let exchange;
  try {
    const response = await fetch(new URL('/api/public/exchange', placetaidOrigin()), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri(),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    exchange = await response.json().catch(() => ({}));
    if (!response.ok) {
      clearStateCookie(res);
      return res.status(response.status === 401 ? 403 : 502).send(exchange.message || 'No se pudo validar la respuesta de PlacetaID');
    }
  } catch {
    clearStateCookie(res);
    return res.status(502).send('No se pudo conectar con PlacetaID');
  }

  const claims = exchange?.claims;
  const dip = String(claims?.dip || '').toUpperCase().replace(/[ -]/g, '');
  if (exchange?.login_correct !== true || !/^\d{8}[A-Z]$/.test(dip)) {
    clearStateCookie(res);
    return res.status(403).send('PlacetaID confirmó la autenticación, pero no incluyó el DIP necesario para vincular tu cuenta de Nexe. Vuelve a iniciar el acceso y, cuando PlacetaID pregunte, permite expresamente compartir el DIP con Nexe. Si ya lo permitiste, contacta con Administración para revisar el permiso de Nexe.');
  }

  try {
    const sb = serverSupabase();
    const { data: profile, error: profileError } = await sb.from('nexe_profiles')
      .select('id,dip,nombre,activo')
      .eq('dip', dip)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || !profile.activo) {
      clearStateCookie(res);
      return res.status(403).send('Esta identidad no tiene una cuenta activa en Nexe');
    }

    const fullName = [claims.name, claims.surname].filter(Boolean).join(' ').trim();
    const { error: updateError } = await sb.from('nexe_profiles')
      .update({
        nombre: fullName || profile.nombre,
        datos_placetaid: claims,
        placetaid_synced_at: new Date().toISOString(),
      })
      .eq('id', profile.id);
    if (updateError) throw updateError;

    const payload = Buffer.from(JSON.stringify({ dip, iat: Date.now() })).toString('base64url');
    const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
    res.setHeader('Set-Cookie', [
      'nexe_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
      `nexe_session=${payload}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`,
    ]);
    return res.redirect('/');
  } catch (error) {
    console.error('[Nexe PlacetaID callback]', error?.code || 'PROFILE_SYNC_FAILED');
    clearStateCookie(res);
    return res.status(503).send('No se pudo actualizar la identidad de Nexe');
  }
}
