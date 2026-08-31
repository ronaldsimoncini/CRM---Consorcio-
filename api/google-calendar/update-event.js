/* Função serverless (Vercel):  POST /api/google-calendar/update-event
 * -------------------------------------------------------------------------
 * Atualiza o evento do Google Calendar de UMA reunião que JÁ possui
 * googleCalendarEventId. NUNCA cria evento novo.
 *
 * SEGURANÇA
 *  - auth_uid vem SEMPRE do JWT (getUserFromToken). auth_uid/owner_uid do body
 *    são ignorados.
 *  - a reunião precisa existir e ter owner_uid === auth_uid do JWT; senão nada
 *    é alterado (nem no CRM, nem no Google).
 *  - o access_token/refresh_token só existem no servidor. Nada de token em
 *    resposta, URL ou log.
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

  /* 2) body — nunca auth_uid/owner_uid */
  const body = await readBody(req);
  const reuniaoId = str(body.reuniaoId).trim();
  const titulo = str(body.titulo).trim();
  const data = str(body.data).trim();
  const horaInicio = str(body.horaInicio).trim();
  const horaFim = str(body.horaFim).trim();
  const observacoes = str(body.observacoes);
  const leadNome = str(body.leadNome).trim();
  const leadTelefone = str(body.leadTelefone).trim();

  if (!reuniaoId) return send(res, 400, { ok: false, code: 'INVALID_INPUT', message: 'reuniaoId ausente.' });
  if (!titulo) return send(res, 400, { ok: false, code: 'INVALID_INPUT', message: 'Título ausente.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return send(res, 400, { ok: false, code: 'INVALID_INPUT', message: 'Data inválida.' });
  if (!/^\d{2}:\d{2}$/.test(horaInicio) || !/^\d{2}:\d{2}$/.test(horaFim)) return send(res, 400, { ok: false, code: 'INVALID_INPUT', message: 'Horário inválido.' });
  if (horaFim < horaInicio) return send(res, 400, { ok: false, code: 'INVALID_INPUT', message: 'Hora final antes da inicial.' });

  try {
    /* 3) reunião precisa existir e ser DESTE usuário */
    const got = await shared.getReuniao(reuniaoId);
    if (got.error) return send(res, 502, { ok: false, code: 'DB_ERROR' });
    const reuniao = got.row;
    if (!reuniao || reuniao.owner_uid !== authUid) return send(res, 404, { ok: false, code: 'REUNIAO_NOT_FOUND' });
    const rdata = reuniao.data || {};

    /* 4) sem evento vinculado -> nada a fazer. NUNCA cria. */
    const eventId = rdata.googleCalendarEventId;
    if (!eventId) return send(res, 200, { ok: true, code: 'NO_EVENT' });

    /* 5) access_token do PRÓPRIO usuário */
    const at = await shared.getGoogleAccessToken(authUid);
    if (at.error === 'not_connected') return send(res, 404, { ok: false, code: 'GOOGLE_NOT_CONNECTED' });
    if (at.error === 'revoked') return send(res, 404, { ok: false, code: 'GOOGLE_REVOKED' });
    if (at.error) return send(res, 502, { ok: false, code: 'GOOGLE_ERROR' });

    /* 6) PATCH do evento (summary/description/start/end; timeZone America/Sao_Paulo) */
    const evt = shared.buildEventResource({
      titulo: titulo, data: data, horaInicio: horaInicio, horaFim: horaFim,
      observacoes: observacoes, leadNome: leadNome, leadTelefone: leadTelefone
    });
    const upd = await shared.patchGoogleEvent(at.access_token, eventId, evt);

    if (upd.gone) {
      await shared.patchReuniaoData(reuniaoId, Object.assign({}, rdata, { googleCalendarStatus: 'missing' }));
      return send(res, 200, { ok: false, code: 'EVENT_MISSING' });
    }
    if (upd.error) {
      console.error('[gcal update-event] Google recusou o PATCH:', upd.error);
      return send(res, 502, { ok: false, code: 'GOOGLE_API_ERROR' });
    }

    /* 7) sucesso -> marcadores na reunião */
    const nd = Object.assign({}, rdata, {
      googleCalendarStatus: 'created',
      googleCalendarUpdated: (upd.event && upd.event.updated) || new Date().toISOString()
    });
    if (upd.event && upd.event.etag) nd.googleCalendarEtag = upd.event.etag;
    await shared.patchReuniaoData(reuniaoId, nd);

    return send(res, 200, { ok: true, code: 'UPDATED', eventId: eventId });
  } catch (e) {
    console.error('[gcal update-event] erro interno');
    return send(res, 500, { ok: false, code: 'INTERNAL' });
  }
};
