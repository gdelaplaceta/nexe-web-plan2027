import crypto from 'node:crypto';
import { cookie, serverSupabase } from './_supabase.js';
import { PRIVACY_VERSION, TERMS_VERSION } from './_legal.js';

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function clearRegistrationCookie() {
  return 'nexe_registration=; HttpOnly; Secure; SameSite=Lax; Path=/api/placetaid-register; Max-Age=0';
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body !== 'string') return {};
  if (String(req.headers['content-type'] || '').includes('application/json')) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(req.body));
}

function accepted(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function sendError(res, status, error) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ error });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const requestHost = String(req.headers.host || '').toLowerCase();
  const origin = String(req.headers.origin || '');
  let originHost = '';
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return sendError(res, 403, 'invalid_origin');
  }
  if (!requestHost || originHost !== requestHost) return sendError(res, 403, 'invalid_origin');

  const secret = String(process.env.NEXE_SESSION_SECRET || '');
  const token = cookie(req, 'nexe_registration');
  const [encoded, signature] = token.split('.');
  if (secret.length < 32 || !encoded || !signature) {
    res.setHeader('Set-Cookie', clearRegistrationCookie());
    return sendError(res, 400, 'registration_expired');
  }

  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  if (!safeEqual(signature, expected)) {
    res.setHeader('Set-Cookie', clearRegistrationCookie());
    return sendError(res, 400, 'registration_expired');
  }

  let pending;
  try {
    pending = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    res.setHeader('Set-Cookie', clearRegistrationCookie(res));
    return sendError(res, 400, 'registration_expired');
  }
  const age = Date.now() - Number(pending.iat);
  if (!/^\d{8}[A-Z]$/.test(String(pending.dip || '')) || age < 0 || age > 10 * 60 * 1000) {
    res.setHeader('Set-Cookie', clearRegistrationCookie(res));
    return sendError(res, 400, 'registration_expired');
  }

  const body = readBody(req);
  if (!accepted(body.acceptTerms) || !accepted(body.acknowledgePrivacy)) {
    return sendError(res, 400, 'legal_acceptance_required');
  }
  const fullName = String(body.fullName || '').replace(/\s+/g, ' ').trim();
  if (fullName.length < 2 || fullName.length > 120 || /[\u0000-\u001f\u007f]/.test(fullName)) {
    return sendError(res, 400, 'invalid_name');
  }

  try {
    const sb = serverSupabase();
    const acceptedAt = new Date().toISOString();
    const registration = {
      dip: pending.dip,
      nombre: fullName,
      rol: 'aspirante',
      activo: true,
      datos_placetaid: { dip: pending.dip, nombre: fullName },
      placetaid_synced_at: acceptedAt,
      terminos_version: TERMS_VERSION,
      terminos_accepted_at: acceptedAt,
      privacidad_version: PRIVACY_VERSION,
      privacidad_acknowledged_at: acceptedAt,
    };

    let profile;
    const inserted = await sb.from('nexe_profiles')
      .insert(registration)
      .select('id,dip,nombre,rol,activo')
      .single();
    if (inserted.error?.code !== '23505') {
      if (inserted.error) throw inserted.error;
      profile = inserted.data;
    } else {
      const existing = await sb.from('nexe_profiles')
        .select('id,dip,nombre,rol,activo')
        .eq('dip', pending.dip)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (!existing.data?.activo) return sendError(res, 409, 'account_not_active');
      profile = existing.data;
      const updated = await sb.from('nexe_profiles')
        .update({
          terminos_version: TERMS_VERSION,
          terminos_accepted_at: acceptedAt,
          privacidad_version: PRIVACY_VERSION,
          privacidad_acknowledged_at: acceptedAt,
        })
        .eq('id', profile.id)
        .eq('activo', true)
        .select('id')
        .maybeSingle();
      if (updated.error) throw updated.error;
      if (!updated.data) return sendError(res, 409, 'account_not_active');
    }

    if (!profile?.activo) return sendError(res, 409, 'account_not_active');
    const sessionPayload = Buffer.from(JSON.stringify({ dip: profile.dip, iat: Date.now() })).toString('base64url');
    const sessionSignature = crypto.createHmac('sha256', secret).update(sessionPayload).digest('base64url');
    res.setHeader('Set-Cookie', [
      clearRegistrationCookie(),
      `nexe_session=${sessionPayload}.${sessionSignature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`,
    ]);
    res.setHeader('Cache-Control', 'no-store');
    if (String(req.headers.accept || '').includes('text/html')) return res.redirect(303, '/');
    return res.status(200).json({ ok: true });
  } catch (error) {
    const code = String(error?.code || '');
    console.error('[Nexe PlacetaID registration] CREATE_PROFILE_FAILED', code || 'SUPABASE_UNAVAILABLE');
    if (['42703', 'PGRST204'].includes(code)) {
      return sendError(res, 503, 'database_schema_outdated');
    }
    if (['42P01', 'PGRST205'].includes(code)) {
      return sendError(res, 503, 'database_schema_missing');
    }
    return sendError(res, 503, 'registration_unavailable');
  }
}
