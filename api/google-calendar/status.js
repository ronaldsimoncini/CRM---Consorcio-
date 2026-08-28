/* Função serverless (Vercel):  GET /api/google-calendar/status
 * -------------------------------------------------------------------------
 * Diz se o usuário autenticado tem o Google Calendar conectado.
 *  - exige Authorization: Bearer <JWT Supabase>;
 *  - auth_uid vem SOMENTE do JWT;
 *  - consulta public.google_calendar_tokens com a SERVICE ROLE KEY;
 *  - responde apenas { connected: bool, google_email? }.
 *
 * NUNCA devolve refresh_token nem qualquer token.
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 */
'use strict';

const shared = require('./_shared');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ connected: false, code: 'METHOD_NOT_ALLOWED' });

  const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'];
  for (let i = 0; i < need.length; i++) if (!process.env[need[i]]) return res.status(500).json({ connected: false, code: 'NOT_CONFIGURED' });

  const u = await shared.getUserFromToken(req);
  if (u.error === 'no_token' || u.error === 'expired') return res.status(401).json({ connected: false, code: 'UNAUTHENTICATED' });
  if (u.error) return res.status(502).json({ connected: false, code: 'AUTH_CHECK_FAILED' });

  const conn = await shared.getGoogleConnection(u.auth_uid);
  if (conn.error) return res.status(502).json({ connected: false, code: 'DB_ERROR' });

  return res.status(200).json(conn); // { connected:true, google_email? } | { connected:false }
};
