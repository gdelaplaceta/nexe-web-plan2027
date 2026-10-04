import crypto from 'node:crypto';
import { serverSupabase } from './_supabase.js';
const cookies = (value='') => Object.fromEntries(value.split(';').map(v=>v.trim().split('=' )).filter(v=>v.length===2));
function readIdentity(value) { try { const o=JSON.parse(decodeURIComponent(String(value))); return o?.dip||o?.userId||o?.sub||o?.placetaId||o?.placeid; } catch { return value; } }
export default async function handler(req, res) {
  const secret=process.env.NEXE_SESSION_SECRET, c=cookies(req.headers.cookie), received=String(req.query.state||'');
  if(!secret||!c.nexe_oauth_state||!received||received!==c.nexe_oauth_state.split('.')[0]||crypto.createHmac('sha256',secret).update(received).digest('base64url')!==c.nexe_oauth_state.split('.')[1]) return res.status(403).send('Estado OAuth inválido');
  if(req.query.error) return res.status(403).send('Autenticación cancelada');
  const token=String(req.query.token||''), raw=req.query.user||req.query.dip||req.query.userId||'';
  let dip=String(readIdentity(raw)||'').toUpperCase();
  if(!dip&&token){try{const p=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());dip=String(p.dip||p.sub||p.userId||p.placetaId||'').toUpperCase()}catch{}}
  if(!dip) return res.status(403).send('PlacetaID no devolvió DIP');
  try { const sb=serverSupabase(); const { error }=await sb.from('nexe_profiles').upsert({ dip, nombre: dip, rsp_verificado: true, rsp_verificado_at: new Date().toISOString() }, { onConflict: 'dip' }); if(error) throw error; } catch { return res.status(503).send('No se pudo registrar el perfil en Supabase'); }
  const payload=Buffer.from(JSON.stringify({dip,token,iat:Date.now()})).toString('base64url');
  const sig=crypto.createHmac('sha256',secret).update(payload).digest('base64url');
  res.setHeader('Set-Cookie',[`nexe_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,`nexe_session=${payload}.${sig}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`]);
  res.redirect('/');
}
