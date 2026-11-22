// Verificación pública de un código seguro de verificación (CSV).
// No requiere sesión. Devuelve solo lo necesario para comprobar la autenticidad:
// nunca el DIP completo, la IP ni el navegador.
// GET /api/verificar?csv=NXE-XXXX-XXXX-XXXX
import { serverSupabase } from './_supabase.js';
import { normalizeCsv } from './_convenio.js';
import { usableSecret } from './_security.js';
import { resultadoFirma, resultadoConvenio, RESULTADO_NO_ENCONTRADO } from './_verificacion.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ valido: false, mensaje: 'Método no permitido.' });

  const code = normalizeCsv(req.query.csv);
  if (!code) return res.status(400).json({ valido: false, mensaje: 'El código no tiene el formato NXE-XXXX-XXXX-XXXX.' });

  const secret = process.env.NEXE_SIGNING_SECRET || process.env.NEXE_SESSION_SECRET;
  if (!usableSecret(secret)) return res.status(503).json({ valido: false, mensaje: 'La verificación no está disponible.' });

  try {
    const sb = serverSupabase();
    const { data: firmas, error: fErr } = await sb.from('nexe_documents')
      .select('collection_path,payload')
      .like('collection_path', 'convenios/%/firmas')
      .eq('payload->>csv', code)
      .limit(1);
    if (fErr) throw fErr;

    if (firmas?.length) {
      const firma = firmas[0].payload;
      const ano = firma.ano;
      const { data: conv, error: cErr } = await sb.from('nexe_documents')
        .select('payload')
        .eq('collection_path', 'convenios')
        .eq('document_id', ano)
        .maybeSingle();
      if (cErr) throw cErr;
      return res.status(200).json(resultadoFirma({ firma, convenio: conv?.payload || null, secret }));
    }

    const { data: convs, error: vErr } = await sb.from('nexe_documents')
      .select('document_id,payload')
      .eq('collection_path', 'convenios')
      .eq('payload->>csv', code)
      .limit(1);
    if (vErr) throw vErr;
    if (convs?.length) {
      return res.status(200).json(resultadoConvenio({ convenio: convs[0].payload, ano: convs[0].document_id, secret }));
    }
    return res.status(404).json(RESULTADO_NO_ENCONTRADO);
  } catch (error) {
    console.error('[Nexe verificar] LOOKUP_FAILED', error?.code || 'VERIFY_UNAVAILABLE');
    return res.status(503).json({ valido: false, mensaje: 'La verificación no está disponible en este momento.' });
  }
}
