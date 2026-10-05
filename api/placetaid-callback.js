import crypto from 'node:crypto';
import { cookie, serverSupabase } from './_supabase.js';
import { PRIVACY_VERSION, TERMS_VERSION } from './_legal.js';

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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
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

function sendRegistrationPage(res, suggestedName) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Crear cuenta · Nexe</title>
    <style>
      *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:#f5f3f8;color:#24212b;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
      main{width:min(100%,520px);padding:clamp(22px,6vw,36px);border:1px solid #e8e3ed;border-radius:20px;background:#fff;box-shadow:0 18px 50px #27143b12}
      .mark{display:grid;place-items:center;width:46px;height:46px;margin-bottom:20px;border-radius:14px;background:#f0eafb;color:#6639a4;font-size:23px;font-weight:700}
      h1{margin:0 0 10px;font-size:25px;line-height:1.2;letter-spacing:-.4px}p{color:#5f5967}
      label{display:block;margin:18px 0 8px;font-weight:600}input[type=text]{width:100%;padding:12px;border:1px solid #d8d2df;border-radius:10px;font:inherit}
      .accept{display:flex;align-items:flex-start;gap:10px;margin:18px 0;font-size:14px;font-weight:400}.accept input{width:18px;height:18px;margin:2px 0 0;flex:none}
      a{color:#6338a0}.action{width:100%;margin-top:8px;padding:13px 18px;border:0;border-radius:10px;background:#6338a0;color:#fff;font:inherit;font-weight:650;cursor:pointer}
      .action:disabled{opacity:.6;cursor:wait}#status{min-height:1.5em;margin:10px 0 0;color:#8a2b2b;font-size:14px}
      @media(max-width:480px){body{padding:14px}main{border-radius:16px}h1{font-size:22px}}
    </style>
  </head>
  <body><main>
    <div class="mark" aria-hidden="true">N</div>
    <h1>Crear tu cuenta de Nexe</h1>
    <p>PlacetaID ha verificado tu identidad. No encontramos una cuenta de Nexe asociada. Revisa los textos legales y confirma para crearla y continuar.</p>
    <form id="registerForm" method="post" action="/api/placetaid-register">
      <label for="fullName">Nombre y apellidos</label>
      <input id="fullName" name="fullName" type="text" autocomplete="name" maxlength="120" required value="${escapeHtml(suggestedName)}">
      <label class="accept"><input id="acceptTerms" name="acceptTerms" type="checkbox" value="true" required><span>He leído y acepto los <a href="/legal/terminos.html" target="_blank" rel="noopener">Términos y condiciones de Nexe</a> (versión ${TERMS_VERSION}).</span></label>
      <label class="accept"><input id="acknowledgePrivacy" name="acknowledgePrivacy" type="checkbox" value="true" required><span>He leído la <a href="/legal/privacidad.html" target="_blank" rel="noopener">Política de privacidad de Nexe</a> (versión ${PRIVACY_VERSION}).</span></label>
      <button class="action" type="submit">Aceptar y crear cuenta</button>
      <p id="status" role="status" aria-live="polite"></p>
    </form>
  </main>
  <script>
    const form=document.querySelector('#registerForm');
    const status=document.querySelector('#status');
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');
      button.disabled=true;
      status.textContent='Creando tu cuenta…';
      try{
        const response=await fetch(form.action,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({
          fullName:form.elements.fullName.value,
          acceptTerms:form.elements.acceptTerms.checked,
          acknowledgePrivacy:form.elements.acknowledgePrivacy.checked
        })});
        const result=await response.json();
        if(!response.ok)throw new Error(result.error==='legal_acceptance_required'?'Debes aceptar los términos y confirmar que has leído la política de privacidad.':result.error==='registration_expired'?'La solicitud ha caducado. Vuelve a iniciar sesión con PlacetaID.':result.error==='invalid_name'?'Introduce tu nombre y apellidos.':result.error==='database_schema_missing'?'La base de datos de Nexe aún no está instalada. Contacta con Administración.':result.error==='database_schema_outdated'?'La base de datos debe actualizarse antes de crear cuentas. Contacta con Administración.':'No se pudo crear la cuenta. Inténtalo de nuevo.');
        window.location.assign('/');
      }catch(error){
        status.textContent=error.message||'No se pudo crear la cuenta. Inténtalo de nuevo.';
        button.disabled=false;
      }
    });
  </script></body>
</html>`);
}

function registrationToken(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
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
      const errorCode = String(exchange?.error || '');
      console.error('[Nexe PlacetaID exchange]', `HTTP_${response.status}`, errorCode || 'UNSPECIFIED');
      if (response.status === 401 && errorCode === 'INVALID_CLIENT') {
        return sendCallbackMessage(
          res,
          503,
          'La integración de Nexe necesita atención',
          'PlacetaID reconoce la aplicación, pero ha rechazado sus credenciales de servidor. La administración de Nexe debe comprobar que PLACETAID_CLIENT_ID y PLACETAID_CLIENT_SECRET pertenecen a la misma integración autorizada. No compartas esos valores.',
          false,
        );
      }
      if (response.status === 400 && errorCode === 'INVALID_OR_EXPIRED_CODE') {
        return sendCallbackMessage(res, 403, 'La autorización ha caducado', 'El código de acceso ya se utilizó, caducó o no coincide con la solicitud. Inicia un nuevo acceso desde Nexe.');
      }
      return sendCallbackMessage(res, 502, 'No se pudo validar el acceso', 'PlacetaID no ha podido confirmar esta autorización. Inicia un nuevo intento desde Nexe.');
    }
  } catch (error) {
    console.error('[Nexe PlacetaID exchange]', error?.name || 'PLACETAID_UNAVAILABLE');
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

  let sb;
  let profile;
  try {
    sb = serverSupabase();
    const result = await sb.from('nexe_profiles')
      .select('id,dip,nombre,activo')
      .eq('dip', dip)
      .maybeSingle();
    if (result.error) throw result.error;
    profile = result.data;
  } catch (error) {
    const errorCode = String(error?.code || '');
    const errorMarker = error?.message === 'supabase_not_configured'
      ? 'SUPABASE_NOT_CONFIGURED'
      : errorCode || 'SUPABASE_UNAVAILABLE';
    console.error('[Nexe PlacetaID callback] PROFILE_LOOKUP_FAILED', errorMarker);
    clearStateCookie(res);
    if (['42P01', 'PGRST205'].includes(errorCode)) {
      return sendCallbackMessage(
        res,
        503,
        'Falta instalar la base de datos de Nexe',
        'La tabla de perfiles aún no está disponible en Supabase. La administración debe ejecutar supabase/schema.sql antes de que puedas crear una cuenta.',
      );
    }
    if (error?.message === 'supabase_not_configured') {
      return sendCallbackMessage(
        res,
        503,
        'Falta configurar Supabase en Nexe',
        'La administración debe configurar SUPABASE_URL y SUPABASE_SECRET_KEY en las variables de entorno de producción.',
        false,
      );
    }
    return sendCallbackMessage(res, 503, 'No se pudo comprobar la cuenta de Nexe', 'Nexe no pudo consultar el perfil de usuario en Supabase. Comprueba la configuración del servidor e inténtalo de nuevo más tarde.');
  }

  if (!profile) {
    const registration = registrationToken({
      dip,
      suggestedName: [claims.name, claims.surname].filter(Boolean).join(' ').trim(),
      iat: Date.now(),
    }, sessionSecret);
    res.setHeader('Set-Cookie', [
      'nexe_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
      `nexe_registration=${registration}; HttpOnly; Secure; SameSite=Lax; Path=/api/placetaid-register; Max-Age=600`,
    ]);
    return sendRegistrationPage(res, [claims.name, claims.surname].filter(Boolean).join(' ').trim());
  }

  if (!profile.activo) {
    clearStateCookie(res);
    return sendCallbackMessage(res, 403, 'No hay una cuenta activa en Nexe', 'La identidad de PlacetaID no está vinculada a una cuenta activa. Contacta con Administración de Nexe si necesitas ayuda.', false);
  }

  const fullName = [claims.name, claims.surname].filter(Boolean).join(' ').trim();
  let profileSyncWarning = false;
  try {
    let { data: updatedProfile, error: updateError } = await sb.from('nexe_profiles')
      .update({
        nombre: fullName || profile.nombre,
        datos_placetaid: claims,
        placetaid_synced_at: new Date().toISOString(),
      })
      .eq('id', profile.id)
      .select('id')
      .maybeSingle();
    if (['42703', 'PGRST204'].includes(updateError?.code)) {
      profileSyncWarning = true;
      console.error('[Nexe PlacetaID callback] PROFILE_OPTIONAL_SYNC_UNAVAILABLE', updateError.code);
      ({ data: updatedProfile, error: updateError } = await sb.from('nexe_profiles')
        .update({ nombre: fullName || profile.nombre })
        .eq('id', profile.id)
        .select('id')
        .maybeSingle());
    }
    if (updateError) throw updateError;
    if (!updatedProfile) throw new Error('PROFILE_UPDATE_NOT_APPLIED');
  } catch (error) {
    profileSyncWarning = true;
    console.error('[Nexe PlacetaID callback] PROFILE_SYNC_FAILED', error?.code || 'PROFILE_SYNC_FAILED');
  }

  try {
    const payload = Buffer.from(JSON.stringify({ dip, iat: Date.now() })).toString('base64url');
    const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
    res.setHeader('Set-Cookie', [
      'nexe_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
      `nexe_session=${payload}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`,
    ]);
    return res.redirect(profileSyncWarning ? '/?placetaid_sync=warning' : '/');
  } catch (error) {
    console.error('[Nexe PlacetaID callback] SESSION_CREATE_FAILED', error?.code || 'SESSION_CREATE_FAILED');
    clearStateCookie(res);
    return sendCallbackMessage(res, 503, 'No se pudo completar el acceso', 'Nexe no pudo iniciar una sesión en este momento. Inténtalo de nuevo más tarde.');
  }
}
