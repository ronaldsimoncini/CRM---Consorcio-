/* Função serverless (Vercel):  GET /api/google-calendar/auth
 * -------------------------------------------------------------------------
 * Início do fluxo OAuth do Google Calendar (Fase 1).
 *  - exige o JWT do usuário logado no CRM (Authorization: Bearer <JWT Supabase>);
 *  - valida o JWT no Supabase e obtém o auth_uid;
 *  - cria um `state` assinado (HMAC-SHA256, validade ~10 min) com { auth_uid, iat, exp };
 *  - devolve { url } — a URL de consentimento do Google.
 *
 * O GOOGLE_CLIENT_SECRET NUNCA é usado aqui nem enviado ao frontend.
 *
 * ENV: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
 *      OAUTH_STATE_SECRET, SUPABASE_URL, SUPABASE_ANON_KEY
 */
'use strict';

const shared = require('./_shared');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });

  const need = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'OAUTH_STATE_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  for (let i = 0; i < need.length; i++) {
    if (!process.env[need[i]]) return res.status(500).json({ error: 'Servidor não configurado (variáveis de ambiente ausentes).' });
  }

  const u = await shared.getUserFromToken(req);
  if (u.error === 'no_token') return res.status(401).json({ error: 'Sua sessão não foi enviada. Entre novamente.' });
  if (u.error === 'expired') return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' });
  if (u.error) {
    console.error('[gcal auth] falha ao validar sessão:', u.error);
    return res.status(502).json({ error: 'Não foi possível validar a sua sessão agora. Tente de novo.' });
  }

  const now = Math.floor(Date.now() / 1000);
  const state = shared.signState(
    { auth_uid: u.auth_uid, iat: now, exp: now + shared.STATE_TTL_SECONDS },
    process.env.OAUTH_STATE_SECRET
  );

  return res.status(200).json({ url: shared.buildConsentUrl(state) });
};
