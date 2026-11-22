// Convenio general de colaboradores y administradores.
//
//   GET  /api/convenio?ano=2027            → texto, estado, firmantes (DIP enmascarado)
//   POST /api/convenio  {action:'publicar'} → administración publica un texto y sus firmantes
//   POST /api/convenio  {action:'firmar'}   → cada firmante firma con su DIP validado
//
// La firma exige: sesión PlacetaID, DIP con letra de control correcta, DIP verificado
// frente a RSP, aceptación de los textos legales vigentes, estar en la lista de
// firmantes y volver a escribir el propio DIP (confirmación reforzada).
import { requireUser, requireSameOrigin, sendAuthError, serverSupabase } from './_supabase.js';
import { isAdminRole, rolesOf } from './_roles.js';
import { TERMS_VERSION, PRIVACY_VERSION } from './_legal.js';
import { MAX_TEXT_BYTES, isPlainObject, isValidDniNie, usableSecret } from './_security.js';
import {
  documentHash, normalizeFirmantes, convenioStatus, buildSignatureReceipt,
  verifySignatureReceipt, convenioCsv, maskDip, CONVENIO_FIELDS_MAX,
} from './_convenio.js';

const ANO_PATTERN = /^20[2-9][0-9]$/;
// Código HTTP de cada motivo de rechazo de firma.
const SIGN_STATUS = {
  convenio_aprobado: 409,
  convenio_sin_firmantes: 409,
  ya_firmado: 409,
  no_firmante: 403,
  dip_invalido: 403,
  rsp_no_verificado: 403,
  legal_pendiente: 403,
};
const DEFAULT_TITLE = 'Convenio General de Colaboradores y Administradores';

function fail(res, status, error) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ error });
}

function signingSecret() {
  return process.env.NEXE_SIGNING_SECRET || process.env.NEXE_SESSION_SECRET || '';
}

async function getDoc(sb, collection, id) {
  const { data, error } = await sb.from('nexe_documents')
    .select('owner_id,payload')
    .eq('collection_path', collection)
    .eq('document_id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadConvenio(sb, ano) {
  const secret = signingSecret();
  const doc = await getDoc(sb, 'convenios', ano);
  if (!doc) return null;
  const firmantesDoc = await getDoc(sb, `convenios/${ano}/firmantes`, 'lista');
  const { data: firmasRows, error } = await sb.from('nexe_documents')
    .select('document_id,payload')
    .eq('collection_path', `convenios/${ano}/firmas`);
  if (error) throw error;
  return {
    ownerId: doc.owner_id,
    doc: doc.payload || {},
    firmantes: firmantesDoc?.payload?.lista || [],
    // Solo cuentan las firmas cuyo recibo es auténtico. Una fila alterada a mano
    // se ignora y la persona vuelve a figurar como pendiente.
    firmas: (firmasRows || []).map(row => row.payload).filter(f => verifySignatureReceipt(f, secret)),
  };
}

async function signerProfile(sb, userId) {
  const { data, error } = await sb.from('nexe_profiles')
    .select('rsp_verificado,terminos_version,privacidad_version,activo')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || {};
}

function legalAccepted(profile) {
  return profile.terminos_version === TERMS_VERSION && profile.privacidad_version === PRIVACY_VERSION;
}

// Motivo por el que una persona no puede firmar ahora, o null si puede.
function signBlockReason({ user, profile, status, mine }) {
  if (status.estado === 'aprobado') return 'convenio_aprobado';
  if (status.estado !== 'pendiente_firma') return 'convenio_sin_firmantes';
  if (!mine) return 'no_firmante';
  if (mine.firmado) return 'ya_firmado';
  if (!isValidDniNie(user.dip)) return 'dip_invalido';
  if (!profile.rsp_verificado) return 'rsp_no_verificado';
  if (!legalAccepted(profile)) return 'legal_pendiente';
  return null;
}

function publicView(ano, conv, status, user, profile) {
  const mine = status.firmantes.find(f => f.dip === user.dip) || null;
  const reason = signBlockReason({ user, profile, status, mine });
  return {
    ano,
    titulo: conv.doc.titulo || DEFAULT_TITLE,
    texto: conv.doc.texto || '',
    docHash: conv.doc.docHash,
    acuerdoRef: conv.doc.acuerdoRef || null,
    estado: status.estado,
    approvedAt: status.estado === 'aprobado' ? (conv.doc.approvedAt || null) : null,
    pendientes: status.pendientes,
    total: status.total,
    firmantes: status.firmantes.map(f => ({
      cargo: f.cargo,
      nombre: f.nombre,
      dip: maskDip(f.dip),
      firmado: f.firmado,
      firmadoAt: f.firmadoAt,
    })),
    miCargo: mine?.cargo || null,
    miFirma: mine?.firmado ? {
      csv: conv.firmas.find(f => f.dip === user.dip && f.docHash === conv.doc.docHash)?.csv || null,
      firmadoAt: mine.firmadoAt,
    } : null,
    csv: status.estado === 'aprobado' ? (conv.doc.csv || null) : null,
    puedoFirmar: reason === null,
    motivoNoFirma: reason,
    perfil: {
      dipValido: isValidDniNie(user.dip),
      rspVerificado: profile.rsp_verificado === true,
      legalAceptado: legalAccepted(profile),
    },
    administra: isAdminRole(rolesOf(user)),
  };
}

async function handleGet(req, res, sb, user) {
  const ano = String(req.query.ano || '');
  if (!ANO_PATTERN.test(ano)) return fail(res, 400, 'invalid_ano');
  const conv = await loadConvenio(sb, ano);
  if (!conv) return fail(res, 404, 'convenio_not_found');
  const status = convenioStatus(conv.firmantes, conv.firmas, conv.doc.docHash);
  const profile = await signerProfile(sb, user.id);
  return res.status(200).json({ data: publicView(ano, conv, status, user, profile) });
}

async function handlePublish(res, sb, user, ip, body) {
  const ano = String(body.ano || '');
  if (!ANO_PATTERN.test(ano)) return fail(res, 400, 'invalid_ano');
  const titulo = String(body.titulo || DEFAULT_TITLE).trim();
  const texto = typeof body.texto === 'string' ? body.texto : '';
  const acuerdoRef = String(body.acuerdoRef || '').trim();
  if (!titulo || titulo.length > CONVENIO_FIELDS_MAX.titulo) return fail(res, 400, 'invalid_titulo');
  if (!texto.trim() || Buffer.byteLength(texto, 'utf8') > MAX_TEXT_BYTES) return fail(res, 400, 'invalid_texto');
  if (acuerdoRef.length > CONVENIO_FIELDS_MAX.acuerdoRef) return fail(res, 400, 'invalid_acuerdo');
  const parsed = normalizeFirmantes(body.firmantes);
  if (!parsed.ok) return fail(res, 400, parsed.error);

  const existing = await getDoc(sb, 'convenios', ano);
  if (existing?.payload?.estado === 'aprobado') return fail(res, 409, 'convenio_ya_aprobado');

  const docHash = documentHash(ano, texto);
  const payload = {
    titulo,
    texto,
    docHash,
    acuerdoRef: acuerdoRef || null,
    estado: 'pendiente_firma',
    publishedAt: new Date().toISOString(),
    publishedBy: user.dip,
  };
  const save = (collection, id, data, owner) => sb.rpc('nexe_save_document', {
    p_collection: collection,
    p_document_id: id,
    p_owner: owner,
    p_actor: user.id,
    p_payload: data,
    p_merge: false,
    p_ip: ip,
  });
  const first = await save('convenios', ano, payload, existing?.owner_id || user.id);
  if (first.error) throw first.error;
  const second = await save(`convenios/${ano}/firmantes`, 'lista', { lista: parsed.firmantes }, user.id);
  if (second.error) throw second.error;

  return handleGetAfterWrite(res, sb, user, ano);
}

async function handleGetAfterWrite(res, sb, user, ano) {
  const conv = await loadConvenio(sb, ano);
  const status = convenioStatus(conv.firmantes, conv.firmas, conv.doc.docHash);
  const profile = await signerProfile(sb, user.id);
  return res.status(200).json({ data: publicView(ano, conv, status, user, profile) });
}

async function handleSign(req, res, sb, user, ip, body) {
  const secret = signingSecret();
  if (!usableSecret(secret)) return fail(res, 503, 'signing_not_configured');
  const ano = String(body.ano || '');
  if (!ANO_PATTERN.test(ano)) return fail(res, 400, 'invalid_ano');

  // Confirmación reforzada: la persona vuelve a escribir su DIP.
  const confirmDip = String(body.confirmDip || '').trim().toUpperCase().replace(/[ -]/g, '');
  if (confirmDip !== user.dip) return fail(res, 400, 'confirmacion_dip_incorrecta');

  const conv = await loadConvenio(sb, ano);
  if (!conv) return fail(res, 404, 'convenio_not_found');
  const status = convenioStatus(conv.firmantes, conv.firmas, conv.doc.docHash);
  const profile = await signerProfile(sb, user.id);
  const mine = status.firmantes.find(f => f.dip === user.dip) || null;
  const reason = signBlockReason({ user, profile, status, mine });
  if (reason) return fail(res, SIGN_STATUS[reason] || 409, reason);

  const signedAt = new Date().toISOString();
  const receipt = buildSignatureReceipt({
    ano,
    dip: user.dip,
    cargo: mine.cargo,
    nombre: mine.nombre,
    docHash: conv.doc.docHash,
    signedAt,
    ip,
    userAgent: req.headers['user-agent'],
  }, secret);

  const signed = await sb.rpc('nexe_save_document', {
    p_collection: `convenios/${ano}/firmas`,
    p_document_id: user.dip,
    p_owner: user.id,
    p_actor: user.id,
    p_payload: { ...receipt, dip: user.dip },
    p_merge: false,
    p_ip: ip,
  });
  if (signed.error) throw signed.error;

  const after = convenioStatus(conv.firmantes, [...conv.firmas, { ...receipt, dip: user.dip }], conv.doc.docHash);
  if (after.estado === 'aprobado') {
    const approved = await sb.rpc('nexe_save_document', {
      p_collection: 'convenios',
      p_document_id: ano,
      p_owner: conv.ownerId,
      p_actor: user.id,
      p_payload: {
        estado: 'aprobado',
        approvedAt: signedAt,
        csv: convenioCsv(secret, { ano, docHash: conv.doc.docHash, approvedAt: signedAt }),
      },
      p_merge: true,
      p_ip: ip,
    });
    if (approved.error) throw approved.error;
  }

  return res.status(200).json({
    ok: true,
    estado: after.estado,
    firmadoAt: signedAt,
    csv: receipt.csv,
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) return fail(res, 405, 'method_not_allowed');

  let session;
  try {
    session = await requireUser(req);
    if (req.method === 'POST') requireSameOrigin(req);
  } catch (error) {
    if (error?.status === 403) return fail(res, 403, 'forbidden_origin');
    if (sendAuthError(res, error)) return;
    return fail(res, 503, 'session_unavailable');
  }

  const { user, ip } = session;
  const sb = session.sb || serverSupabase();
  try {
    if (req.method === 'GET') return await handleGet(req, res, sb, user);
    const body = isPlainObject(req.body) ? req.body : {};
    if (body.action === 'publicar') {
      if (!isAdminRole(rolesOf(user))) return fail(res, 403, 'forbidden');
      return await handlePublish(res, sb, user, ip, body);
    }
    if (body.action === 'firmar') return await handleSign(req, res, sb, user, ip, body);
    return fail(res, 400, 'unsupported_action');
  } catch (error) {
    const code = String(error?.code || '');
    if (['42P01', 'PGRST205', '42883'].includes(code)) return fail(res, 503, 'database_schema_missing');
    console.error('[Nexe convenio] REQUEST_FAILED', code || 'CONVENIO_UNAVAILABLE');
    return fail(res, 503, 'convenio_unavailable');
  }
}
