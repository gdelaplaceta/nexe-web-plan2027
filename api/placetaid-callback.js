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

function sendCallbackMessage(res, status, title, message, retry = true) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title} · Nexe</title>
    <style>
      *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:#f5f3f8;color:#24212b;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
      main{width:min(100%,460px);padding:32px;border:1px solid #e8e3ed;border-radius:20px;background:#fff;box-shadow:0 18px 50px #27143b12}
      .mark{display:grid;place-items:center;width:46px;height:46px;margin-bottom:22px;border-radius:14px;background:#f0eafb;color:#6639a4;font-size:23px}
      h1{margin:0 0 12px;font-size:24px;line-height:1.2;letter-spacing:-.4px}p{margin:0;color:#5f5967}
      .action{display:inline-flex;justify-content:center;margin-top:24px;padding:12px 18px;border-radius:10px;background:#6338a0;color:#fff;font-weight:650;text-decoration:none}
      @media(max-width:480px){main{padding:24px;border-radius:16px}h1{font-size:21px}}
    </style>
  </head>
  <body><main><div class="mark" aria-hidden="true">N</div><h1>${title}</h1><p>${message}</p>${retry ? '<a class="action" href="/api/placetaid-login">Volver a intentarlo</a>' : ''}</main></body>
</html>`);
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
    return sendCallbackMessage(res, 403, 'No se pudo validar el acceso', 'El enlace de autenticación no es válido o ya caducó. Inicia el acceso desde Nexe para generar uno nuevo.');
  }
  const expectedSignature = crypto.createHmac('sha256', sessionSecret).update(receivedState).digest('base64url');
  if (!safeEqual(stateSignature, expectedSignature)) {
    clearStateCookie(res);
    return sendCallbackMessage(res, 403, 'No se pudo validar el acceso', 'El enlace de autenticación no es válido o ya caducó. Inicia el acceso desde Nexe para generar uno nuevo.');
  }
  if (req.query.error) {
    clearStateCookie(res);
    return sendCallbackMessage(res, 403, 'Acceso cancelado', 'No se ha iniciado sesión en Nexe. Puedes volver a PlacetaID cuando quieras para continuar.');
  }
  if (!code) {
    clearStateCookie(res);
    return sendCallbackMessage(res, 400, 'No se recibió la autorización', 'PlacetaID no ha devuelto el código necesario para completar el acceso. Vuelve a intentarlo desde Nexe.');
  }

  const clientId = String(process.env.PLACETAID_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.PLACETAID_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    clearStateCookie(res);
    return sendCallbackMessage(res, 503, 'Acceso temporalmente no disponible', 'La integración de PlacetaID necesita atención. Inténtalo de nuevo más tarde.');
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
      return sendCallbackMessage(res, response.status === 401 ? 403 : 502, 'No se pudo validar el acceso', 'PlacetaID no ha podido confirmar esta autorización. Inicia un nuevo intento desde Nexe.');
    }
  } catch {
    clearStateCookie(res);
    return sendCallbackMessage(res, 502, 'No se pudo conectar con PlacetaID', 'Comprueba tu conexión e inténtalo de nuevo. No se ha iniciado sesión en Nexe.');
  }

  const claims = exchange?.claims;
  const dip = String(claims?.dip || '').toUpperCase().replace(/[ -]/g, '');
  if (exchange?.login_correct !== true || !/^\d{8}[A-Z]$/.test(dip)) {
    clearStateCookie(res);
    return sendCallbackMessage(
      res,
      403,
      'Nexe necesita tu permiso para el DIP',
      'Para tramitar plazas y convocatorias, firmar acuerdos o acceder a información confidencial, Nexe necesita que autorices compartir tu DIP con Nexe en PlacetaID. No se ha iniciado una sesión incompleta. Vuelve a intentarlo y acepta ese permiso cuando PlacetaID te lo solicite.',
    );
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
      return sendCallbackMessage(res, 403, 'No hay una cuenta activa en Nexe', 'La identidad de PlacetaID no está vinculada a una cuenta activa. Contacta con Administración de Nexe si necesitas ayuda.', false);
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
    return sendCallbackMessage(res, 503, 'No se pudo completar el acceso', 'Nexe no pudo actualizar tu identidad en este momento. Inténtalo de nuevo más tarde.');
  }
}
