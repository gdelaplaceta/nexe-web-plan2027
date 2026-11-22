// Emite un recibo firmado de aceptación del convenio.
// El texto aceptado se envía al servidor, que calcula su huella (SHA-256),
// registra la firma en el registro de auditoría y devuelve un recibo firmado
// con el secreto del servidor. La cuenta solo se guarda con ese recibo.
import { requireUser, requireSameOrigin, sendAuthError } from './_supabase.js';
import { buildReceipt, usableSecret, MAX_TEXT_BYTES } from './_security.js';

function fail(res, status, error) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ error });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed');

  let session;
  try {
    session = await requireUser(req);
    requireSameOrigin(req);
  } catch (error) {
    if (error?.status === 403) return fail(res, 403, 'forbidden_origin');
    if (sendAuthError(res, error)) return;
    return fail(res, 503, 'session_unavailable');
  }

  const secret = process.env.NEXE_SESSION_SECRET;
  if (!usableSecret(secret)) return fail(res, 503, 'signing_not_configured');

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const text = typeof body.texto === 'string' ? body.texto : '';
  const version = typeof body.version === 'string' ? body.version.slice(0, 40) : '';
  if (!text.trim() || Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
    return fail(res, 400, 'invalid_text');
  }
  if (!version) return fail(res, 400, 'version_required');

  const signedAt = new Date().toISOString();
  const receipt = buildReceipt({ dip: session.user.dip, version, text, signedAt, ip: session.ip }, secret);

  try {
    const { error } = await session.sb.rpc('nexe_log_event', {
      p_actor: session.user.id,
      p_action: 'consent',
      p_collection: 'acceptances',
      p_document_id: session.user.dip,
      p_after: { version, textHash: receipt.textHash, signedAt },
      p_ip: session.ip,
    });
    if (error) throw error;
  } catch (error) {
    console.error('[Nexe consent] AUDIT_FAILED', error?.code || 'AUDIT_UNAVAILABLE');
    return fail(res, 503, 'audit_unavailable');
  }

  return res.status(200).json({
    ip: session.ip,
    signedAt,
    receipt,
  });
}
