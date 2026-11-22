// Archivo de presidencia: vista de todas las personas y de sus registros.
// Funciones puras, sin dependencias. El endpoint solo lee y llama aquí.
import { effectiveRoles, primaryRole, rolesFromPlazas, presidentDip } from './_roles.js';

// Vista de lista: una fila por persona, con roles calculados.
//   profiles:  [{id, dip, nombre, rol, activo, rsp_verificado}]
//   resDocs:   [{collection_path:'notas/<dip>/res', document_id, payload}]
//   convDocs:  [{document_id, payload}]            (convocatorias)
//   firmas:    [{payload:{dip, ano, cargo, signedAt}}]
export function listaArchivo({ profiles, resDocs, convDocs, firmas }) {
  const presidente = presidentDip();
  const resByDip = new Map();
  for (const r of resDocs) {
    const dip = r.collection_path.split('/')[1];
    if (!resByDip.has(dip)) resByDip.set(dip, []);
    resByDip.get(dip).push(r);
  }
  const firmasByDip = new Map();
  for (const f of firmas) {
    const dip = f.payload?.dip;
    if (!firmasByDip.has(dip)) firmasByDip.set(dip, []);
    firmasByDip.get(dip).push(f.payload);
  }
  const convs = new Map(convDocs.map(c => [c.document_id, c.payload || {}]));

  return profiles
    .map(p => {
      const res = resByDip.get(p.dip) || [];
      const roles = effectiveRoles({
        profileRol: p.rol,
        plazaRoles: rolesFromPlazas(res, convDocs),
        isPresident: p.dip === presidente,
      });
      const plazas = res
        .filter(r => r.payload?.estado === 'plaza')
        .map(r => ({ convocatoria: convs.get(r.document_id)?.titulo || r.document_id, estado: 'plaza' }));
      const misFirmas = (firmasByDip.get(p.dip) || []).sort((a, b) => String(b.signedAt).localeCompare(String(a.signedAt)));
      return {
        dip: p.dip,
        nombre: p.nombre || p.dip,
        activo: p.activo !== false,
        rspVerificado: p.rsp_verificado === true,
        roles,
        rolPrincipal: primaryRole(roles),
        plazas,
        firmasConvenio: misFirmas.length,
        ultimaFirma: misFirmas[0]?.signedAt || null,
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

// Ficha de una persona: todo lo que consta a su nombre en Nexe.
//   plazas:      [{document_id, payload}]  (notas/<dip>/res)
//   firmas:      [{payload}]               (convenios/<ano>/firmas, dip)
//   descansos:   [{payload}]               (calendario/<ano>/descansos, dip)
//   aceptaciones:[{payload}]               (calendario/<ano>/aceptaciones, dip)
//   convenioAceptado: payload de acceptances/<dip> o null
export function fichaArchivo({ dip, nombre, convDocs, plazas, firmas, descansos, aceptaciones, convenioAceptado }) {
  const convs = new Map(convDocs.map(c => [c.document_id, c.payload || {}]));
  return {
    dip,
    nombre: nombre || dip,
    plazas: plazas.map(p => ({
      convocatoria: convs.get(p.document_id)?.titulo || p.document_id,
      estado: p.payload?.estado || '—',
      rolConcedido: convs.get(p.document_id)?.rolConcedido || 'colaborador',
    })),
    firmasConvenio: firmas.map(f => ({
      ano: f.payload?.ano, cargo: f.payload?.cargo, firmadoAt: f.payload?.signedAt, csv: f.payload?.csv,
    })),
    descansos: descansos
      .map(d => ({ fecha: d.payload?.fecha, estado: d.payload?.estado, solicitadaAt: d.payload?.solicitadaAt }))
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))),
    actividades: aceptaciones.map(a => ({ fecha: a.payload?.fecha, aceptadaAt: a.payload?.aceptadaAt })),
    convenioAceptado: convenioAceptado
      ? { fecha: convenioAceptado.acceptedAt || null, version: convenioAceptado.version || null }
      : null,
  };
}
