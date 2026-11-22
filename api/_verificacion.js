// Verificación pública de CSV. Sin dependencias: testeable sin Supabase.
import { verifySignatureReceipt, convenioCsv, maskDip } from './_convenio.js';

// Resultado para una firma. `convenio` es el documento actual del convenio.
export function resultadoFirma({ firma, convenio, secret }) {
  const autentica = verifySignatureReceipt(firma, secret);
  const textoVigente = Boolean(convenio) && convenio.docHash === firma.docHash;
  let mensaje = 'No se puede verificar este código.';
  if (autentica && textoVigente) mensaje = 'Firma auténtica sobre el texto vigente del convenio.';
  else if (autentica) mensaje = 'Firma auténtica, pero sobre una versión anterior del texto.';
  return {
    valido: autentica,
    tipo: 'firma',
    mensaje,
    ano: firma.ano,
    titulo: convenio?.titulo || null,
    firmante: { cargo: firma.cargo, nombre: firma.nombre, dip: maskDip(firma.dip) },
    fecha: firma.signedAt,
    textoVigente,
    convenioAprobado: convenio?.estado === 'aprobado',
  };
}

// Resultado para el convenio aprobado. Recalcula el CSV con el secreto del servidor.
export function resultadoConvenio({ convenio, ano, secret }) {
  const aprobado = convenio?.estado === 'aprobado' && Boolean(convenio.approvedAt);
  const autentica = aprobado && convenio.csv === convenioCsv(secret, {
    ano, docHash: convenio.docHash, approvedAt: convenio.approvedAt,
  });
  return {
    valido: autentica,
    tipo: 'convenio',
    mensaje: autentica
      ? 'Convenio aprobado. Su texto no ha cambiado desde la aprobación.'
      : 'No se puede verificar este código.',
    ano,
    titulo: convenio?.titulo || null,
    fecha: convenio?.approvedAt || null,
    textoVigente: autentica,
    convenioAprobado: aprobado,
  };
}

export const RESULTADO_NO_ENCONTRADO = Object.freeze({
  valido: false,
  tipo: null,
  mensaje: 'No se encuentra ningún documento con este código.',
});
