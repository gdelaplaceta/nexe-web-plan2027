// Calendario institucional y días individuales de descanso.
//
//   GET  /api/calendario?ano=2027        → festivos, actividades, mis descansos (y revisión si administra)
//   POST /api/calendario {action}        → solicitar_descanso · cancelar_descanso · aceptar_actividad
//                                          renunciar_actividad · publicar_actividad · revisar_descanso
//
// Las reglas (antelación de 7 días, 10 días por persona, incompatibilidades con
// actividades y festivos) se aplican aquí, en el servidor. La interfaz solo las refleja.
import { requireUser, requireSameOrigin, sendAuthError, serverSupabase } from './_supabase.js';
import { isAdminRole } from './_roles.js';
import { isPlainObject } from './_security.js';
import {
  festivosOf, isIsoDate, todayIso, motivoSolicitud, motivoAceptarActividad,
  resumenDescansos, ANOS_CONFIGURADOS, ANTELACION_DIAS,
} from './_calendario.js';

const SIGN_STATUS = {
  ano_no_configurado: 400, fecha_invalida: 400, antelacion_insuficiente: 409, es_festivo: 409,
  ya_solicitado: 409, sin_saldo: 409, conflicto_actividad: 409, conflicto_descanso: 409,
  actividad_no_encontrada: 404, ya_aceptada: 409, no_aceptada: 409, descanso_no_encontrado: 404,
  descanso_no_pendiente: 409, motivo_requerido: 400, titulo_requerido: 400,
  no_autorizado: 403,
};
const MAX_TITULO = 120;
const MAX_DESC = 1000;
const MAX_MOTIVO = 400;

function fail(res, status, error) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ error });
}

async function rows(sb, collection) {
  const { data, error } = await sb.from('nexe_documents')
    .select('document_id,owner_id,payload')
    .eq('collection_path', collection);
  if (error) throw error;
  return data || [];
}

async function save(sb, { collection, id, payload, owner, actor, ip, merge = false }) {
  const { data, error } = await sb.rpc('nexe_save_document', {
    p_collection: collection, p_document_id: id, p_owner: owner, p_actor: actor,
    p_payload: payload, p_merge: merge, p_ip: ip,
  });
  if (error) throw error;
  return data;
}

async function remove(sb, { collection, id, actor, ip }) {
  const { error } = await sb.rpc('nexe_delete_document', {
    p_collection: collection, p_document_id: id, p_actor: actor, p_ip: ip,
  });
  if (error) throw error;
}

function base(ano) {
  return {
    actividades: `calendario/${ano}/actividades`,
    aceptaciones: `calendario/${ano}/aceptaciones`,
    descansos: `calendario/${ano}/descansos`,
  };
}

function maskDip(dip) {
  return dip && dip.length >= 5 ? `••••${dip.slice(-5)}` : '—';
}

async function state(sb, ano, dip) {
  const c = base(ano);
  const [act, acep, desc] = await Promise.all([rows(sb, c.actividades), rows(sb, c.aceptaciones), rows(sb, c.descansos)]);
  const actividades = act.map(r => ({ id: r.document_id, ...r.payload }))
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  const aceptaciones = acep.map(r => r.payload);
  const solicitudes = desc.map(r => ({ id: r.document_id, owner_id: r.owner_id, ...r.payload }));
  return { actividades, aceptaciones, solicitudes, mine: solicitudes.filter(s => s.dip === dip) };
}

function fechasAceptadas(aceptaciones, dip, actividades) {
  const porId = new Map(actividades.map(a => [a.id, a]));
  return new Set(aceptaciones.filter(a => a.dip === dip).map(a => porId.get(a.actividadId)?.fecha).filter(Boolean));
}

async function handleGet(req, res, sb, user) {
  const ano = String(req.query.ano || '');
  if (!ANOS_CONFIGURADOS.includes(ano)) return fail(res, 400, 'ano_no_configurado');
  const st = await state(sb, ano, user.dip);
  const hoy = todayIso();
  const admin = isAdminRole(user.role);
  const aceptadas = fechasAceptadas(st.aceptaciones, user.dip, st.actividades);
  const resumen = resumenDescansos(st.mine);
  const porActividad = st.aceptaciones.reduce((m, a) => m.set(a.actividadId, (m.get(a.actividadId) || 0) + 1), new Map());

  return res.status(200).json({
    data: {
      ano,
      hoy,
      antelacionDias: ANTELACION_DIAS,
      festivos: festivosOf(ano).map(([fecha, nombre]) => ({ fecha, nombre })),
      actividades: st.actividades.map(a => ({
        id: a.id, titulo: a.titulo, fecha: a.fecha, descripcion: a.descripcion || '',
        aceptada: st.aceptaciones.some(x => x.dip === user.dip && x.actividadId === a.id),
        inscritas: admin ? porActividad.get(a.id) || 0 : undefined,
        pasada: a.fecha < hoy,
      })),
      descansos: resumen,
      misDescansos: st.mine
        .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
        .map(s => ({ id: s.id, fecha: s.fecha, estado: s.estado, motivo: s.motivo || null, solicitadaAt: s.solicitadaAt })),
      administra: admin,
      pendientesRevision: admin
        ? st.solicitudes.filter(s => s.estado === 'pendiente')
          .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
          .map(s => ({ id: s.id, nombre: s.nombre, dip: maskDip(s.dip), fecha: s.fecha, solicitadaAt: s.solicitadaAt, conflicto: fechasAceptadas(st.aceptaciones, s.dip, st.actividades).has(s.fecha) }))
        : [],
      aceptadasFechas: [...aceptadas].sort(),
    },
  });
}

async function handleSolicitar(res, sb, user, ip, body) {
  const ano = String(body.ano || '');
  const fecha = String(body.fecha || '');
  const hoy = todayIso();
  const st = await state(sb, ano, user.dip);
  const festivos = new Set(festivosOf(ano).map(([f]) => f));
  const motivo = motivoSolicitud({
    ano, fecha, hoy,
    usados: resumenDescansos(st.mine).usados,
    yaSolicitado: st.mine.some(s => s.fecha === fecha && (s.estado === 'pendiente' || s.estado === 'aprobada')),
    actividadesAceptadas: fechasAceptadas(st.aceptaciones, user.dip, st.actividades),
    festivos,
  });
  if (motivo) return fail(res, SIGN_STATUS[motivo] || 400, motivo);

  const id = crypto.randomUUID();
  const payload = {
    dip: user.dip, nombre: user.name, fecha, estado: 'pendiente',
    solicitadaAt: new Date().toISOString(),
  };
  await save(sb, { collection: base(ano).descansos, id, payload, owner: user.id, actor: user.id, ip });
  return res.status(201).json({ ok: true, id });
}

async function handleCancelar(res, sb, user, ip, body) {
  const ano = String(body.ano || '');
  const id = String(body.id || '');
  const st = await state(sb, ano, user.dip);
  const sol = st.mine.find(s => s.id === id);
  if (!sol) return fail(res, 404, 'descanso_no_encontrado');
  if (sol.estado !== 'pendiente') return fail(res, 409, 'descanso_no_pendiente');
  await remove(sb, { collection: base(ano).descansos, id, actor: user.id, ip });
  return res.status(200).json({ ok: true });
}

async function handleAceptarActividad(res, sb, user, ip, body, accept) {
  const ano = String(body.ano || '');
  const actividadId = String(body.actividadId || '');
  const st = await state(sb, ano, user.dip);
  const act = st.actividades.find(a => a.id === actividadId);
  if (!act) return fail(res, 404, 'actividad_no_encontrada');
  const key = `${user.dip}__${actividadId}`;
  const yaAceptada = st.aceptaciones.some(a => a.dip === user.dip && a.actividadId === actividadId);

  if (!accept) {
    if (!yaAceptada) return fail(res, 409, 'no_aceptada');
    await remove(sb, { collection: base(ano).aceptaciones, id: key, actor: user.id, ip });
    return res.status(200).json({ ok: true, aceptada: false });
  }
  if (yaAceptada) return fail(res, 409, 'ya_aceptada');
  const descansosAprobados = new Set(st.mine.filter(s => s.estado === 'aprobada').map(s => s.fecha));
  const motivo = motivoAceptarActividad({ fecha: act.fecha, descansosAprobados });
  if (motivo) return fail(res, SIGN_STATUS[motivo] || 409, motivo);

  await save(sb, {
    collection: base(ano).aceptaciones, id: key, owner: user.id, actor: user.id, ip,
    payload: { dip: user.dip, actividadId, fecha: act.fecha, aceptadaAt: new Date().toISOString() },
  });
  return res.status(200).json({ ok: true, aceptada: true });
}

async function handlePublicarActividad(res, sb, user, ip, body) {
  const ano = String(body.ano || '');
  if (!ANOS_CONFIGURADOS.includes(ano)) return fail(res, 400, 'ano_no_configurado');
  const titulo = String(body.titulo || '').trim();
  const fecha = String(body.fecha || '');
  const descripcion = String(body.descripcion || '').trim();
  if (!titulo || titulo.length > MAX_TITULO) return fail(res, 400, 'titulo_requerido');
  if (!isIsoDate(fecha) || !fecha.startsWith(`${ano}-`)) return fail(res, 400, 'fecha_invalida');
  if (descripcion.length > MAX_DESC) return fail(res, 400, 'descripcion_demasiado_larga');
  const id = crypto.randomUUID();
  await save(sb, {
    collection: base(ano).actividades, id, owner: user.id, actor: user.id, ip,
    payload: { titulo, fecha, descripcion, creadaPor: user.dip, creadaAt: new Date().toISOString() },
  });
  return res.status(201).json({ ok: true, id });
}

async function handleRevisar(res, sb, user, ip, body) {
  const ano = String(body.ano || '');
  const id = String(body.id || '');
  const decision = body.decision;
  const st = await state(sb, ano, user.dip);
  const sol = st.solicitudes.find(s => s.id === id);
  if (!sol) return fail(res, 404, 'descanso_no_encontrado');
  if (sol.estado !== 'pendiente') return fail(res, 409, 'descanso_no_pendiente');

  if (decision === 'rechazar') {
    const motivo = String(body.motivo || '').trim();
    if (motivo.length < 5 || motivo.length > MAX_MOTIVO) return fail(res, 400, 'motivo_requerido');
    await save(sb, {
      collection: base(ano).descansos, id, owner: sol.owner_id || user.id, actor: user.id, ip, merge: true,
      payload: { estado: 'rechazada', motivo, revisadaPor: user.dip, revisadaAt: new Date().toISOString() },
    });
    return res.status(200).json({ ok: true, estado: 'rechazada' });
  }
  if (decision !== 'aprobar') return fail(res, 400, 'decision_invalida');

  // Al aprobar se comprueba de nuevo: pudo aceptarse una actividad después de solicitar.
  const aceptadas = fechasAceptadas(st.aceptaciones, sol.dip, st.actividades);
  if (aceptadas.has(sol.fecha)) return fail(res, 409, 'conflicto_actividad');
  await save(sb, {
    collection: base(ano).descansos, id, owner: sol.owner_id || user.id, actor: user.id, ip, merge: true,
    payload: { estado: 'aprobada', revisadaPor: user.dip, revisadaAt: new Date().toISOString() },
  });
  return res.status(200).json({ ok: true, estado: 'aprobada' });
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
    const admin = isAdminRole(user.role);
    switch (body.action) {
      case 'solicitar_descanso': return await handleSolicitar(res, sb, user, ip, body);
      case 'cancelar_descanso': return await handleCancelar(res, sb, user, ip, body);
      case 'aceptar_actividad': return await handleAceptarActividad(res, sb, user, ip, body, true);
      case 'renunciar_actividad': return await handleAceptarActividad(res, sb, user, ip, body, false);
      case 'publicar_actividad':
        if (!admin) return fail(res, 403, 'no_autorizado');
        return await handlePublicarActividad(res, sb, user, ip, body);
      case 'revisar_descanso':
        if (!admin) return fail(res, 403, 'no_autorizado');
        return await handleRevisar(res, sb, user, ip, body);
      default:
        return fail(res, 400, 'unsupported_action');
    }
  } catch (error) {
    const code = String(error?.code || '');
    if (['42P01', 'PGRST205', '42883'].includes(code)) return fail(res, 503, 'database_schema_missing');
    console.error('[Nexe calendario] REQUEST_FAILED', code || 'CALENDARIO_UNAVAILABLE');
    return fail(res, 503, 'calendario_unavailable');
  }
}
