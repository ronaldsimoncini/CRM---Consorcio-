/* Função serverless (Vercel):  POST /api/google-calendar/cancel-event
 * -------------------------------------------------------------------------
 * Remove do Google Calendar o evento de UMA reunião que JÁ possui
 * googleCalendarEventId. NUNCA cria evento. NÃO apaga a reunião do CRM.
 *
 * SEGURANÇA
 *  - auth_uid vem SEMPRE do JWT (getUserFromToken). auth_uid/owner_uid do body
 *    são ignorados.
 *  - a reunião precisa existir e ter owner_uid === auth_uid do JWT; senão nada
 *    é alterado.
 *  - o access_token/refresh_token só existem no servidor.
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
 *      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 */
'use strict';

const shared = require('./_shared');

function send(res, code, obj) { res.setHeader('Cache-Control', 'no-store'); return res.status(code).json(obj); }
function str(v) { return v == null ? '' : String(v); }

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  try {
    const chunks = [];
    for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return send(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });

  const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
  for (let i = 0; i < need.length; i++) if (!process.env[need[i]]) return send(res, 500, { ok: false, code: 'NOT_CONFIGURED' });

  /* 1) identidade — SOMENTE do JWT */
  const u = await shared.getUserFromToken(req);
  if (u.error === 'no_token' || u.error === 'expired') return send(res, 401, { ok: false, code: 'UNAUTHENTICATED' });
  if (u.error) return send(res, 502, { ok: false, code: 'AUTH_CHECK_FAILED' });
  const authUid = u.auth_uid;

  /* 2) body — só reuniaoId */
  const body = await readBody(req);
  const reuniaoId = str(body.reuniaoId).trim();
  if (!reuniaoId) return send(res, 400, { ok: false, code: 'INVALID_INPUT', message: 'reuniaoId ausente.' });

  try {
    /* 3) reunião precisa existir e ser DESTE usuário */
    const got = await shared.getReuniao(reuniaoId);
    if (got.error) return send(res, 502, { ok: false, code: 'DB_ERROR' });
    const reuniao = got.row;
    if (!reuniao || reuniao.owner_uid !== authUid) return send(res, 404, { ok: false, code: 'REUNIAO_NOT_FOUND' });
    const rdata = reuniao.data || {};

    /* 4) sem evento vinculado -> nada a fazer */
    const eventId = rdata.googleCalendarEventId;
    if (!eventId) return send(res, 200, { ok: true, code: 'NO_EVENT' });

    /* 5) access_token do PRÓPRIO usuário */
    const at = await shared.getGoogleAccessToken(authUid);
    if (at.error === 'not_connected') return send(res, 404, { ok: false, code: 'GOOGLE_NOT_CONNECTED' });
    if (at.error === 'revoked') return send(res, 404, { ok: false, code: 'GOOGLE_REVOKED' });
    if (at.error) return send(res, 502, { ok: false, code: 'GOOGLE_ERROR' });

    /* 6) DELETE do evento (404/410 = já removido -> sucesso) */
    const del = await shared.deleteGoogleEvent(at.access_token, eventId);
    if (del.error) {
      console.error('[gcal cancel-event] Google recusou o DELETE:', del.error);
      return send(res, 502, { ok: false, code: 'GOOGLE_API_ERROR' });
    }

    /* 7) marca a reunião (não remove o googleCalendarEventId — audita o que foi cancelado) */
    await shared.patchReuniaoData(reuniaoId, Object.assign({}, rdata, { googleCalendarStatus: 'cancelled' }));

    return send(res, 200, { ok: true, code: del.gone ? 'ALREADY_GONE' : 'CANCELLED' });
  } catch (e) {
    console.error('[gcal cancel-event] erro interno');
    return send(res, 500, { ok: false, code: 'INTERNAL' });
  }
};
