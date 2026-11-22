// Archivo de presidencia. Solo lectura, solo para el rol presidencia.
//   GET /api/archivo             → lista de personas con roles y plazas
//   GET /api/archivo?dip=XXXX    → ficha completa de una persona
import { requireUser, sendAuthError } from './_supabase.js';
import { isPresidentRole, rolesOf } from './_roles.js';
import { isDip } from './_security.js';
import { listaArchivo, fichaArchivo } from './_archivo.js';

async function rows(sb, query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const { sb, user } = await requireUser(req);
    if (!isPresidentRole(rolesOf(user))) return res.status(403).json({ error: 'forbidden' });

    const dip = req.query.dip ? String(req.query.dip).toUpperCase() : null;
    const convDocs = await rows(sb, sb.from('nexe_documents').select('document_id,payload').eq('collection_path', 'convocatorias'));

    if (!dip) {
      const profiles = await rows(sb, sb.from('nexe_profiles').select('id,dip,nombre,rol,activo,rsp_verificado'));
      const resDocs = await rows(sb, sb.from('nexe_documents').select('collection_path,document_id,payload').like('collection_path', 'notas/%/res'));
      const firmas = await rows(sb, sb.from('nexe_documents').select('payload').like('collection_path', 'convenios/%/firmas'));
      return res.status(200).json({ data: listaArchivo({ profiles, resDocs, convDocs, firmas }) });
    }

    if (!isDip(dip)) return res.status(400).json({ error: 'invalid_dip' });
    const profile = (await rows(sb, sb.from('nexe_profiles').select('id,dip,nombre').eq('dip', dip)))[0];
    const plazas = await rows(sb, sb.from('nexe_documents').select('document_id,payload').eq('collection_path', `notas/${dip}/res`));
    const firmas = await rows(sb, sb.from('nexe_documents').select('payload').like('collection_path', 'convenios/%/firmas').eq('document_id', dip));
    const descansosAll = await rows(sb, sb.from('nexe_documents').select('payload').like('collection_path', 'calendario/%/descansos'));
    const acepAll = await rows(sb, sb.from('nexe_documents').select('payload').like('collection_path', 'calendario/%/aceptaciones'));
    const convenioDoc = (await rows(sb, sb.from('nexe_documents').select('payload').eq('collection_path', 'acceptances').eq('document_id', dip)))[0];

    return res.status(200).json({
      data: fichaArchivo({
        dip,
        nombre: profile?.nombre,
        convDocs,
        plazas,
        firmas,
        descansos: descansosAll.filter(d => d.payload?.dip === dip),
        aceptaciones: acepAll.filter(a => a.payload?.dip === dip),
        convenioAceptado: convenioDoc?.payload || null,
      }),
    });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    console.error('[Nexe archivo] REQUEST_FAILED', error?.code || 'ARCHIVO_UNAVAILABLE');
    return res.status(503).json({ error: 'archivo_unavailable' });
  }
}
