/* Função serverless (Vercel):  POST /api/google-calendar/create-event
 * -------------------------------------------------------------------------
 * Cria UM evento no Google Calendar PRIMARY da conta conectada pelo próprio
 * usuário autenticado, a partir de uma reunião do CRM.
 *
 * SEGURANÇA
 *  - auth_uid vem SEMPRE do JWT do Supabase (getUserFromToken). O body é
 *    ignorado como fonte de identidade — não lê auth_uid nem owner_uid.
 *  - a reunião precisa existir e ter owner_uid === auth_uid do JWT.
 *  - o refresh_token/access_token vivem só no servidor (SERVICE ROLE +
 *    _shared.js). Nada de token na resposta, na URL ou em log.
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
 *      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 */
'use strict';

const shared = require('./_shared');

const GOOGLE_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const FIND_TRIES = 5;
const FIND_DELAY_MS = 400;

function send(res, code, obj) { res.setHeader('Cache-Control', 'no-store'); return res.status(code).json(obj); }
function str(v) { return v == null ? '' : String(v); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

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

/* Busca a reunião (SERVICE ROLE) com retry curto: a gravação do frontend
   (fila do Store) pode ainda estar em trânsito quando esta rota roda. */
async function fetchReuniao(reuniaoId) {
  const url = process.env.SUPABASE_URL + '/rest/v1/reunioes?id=eq.' + encodeURIComponent(reuniaoId) +
    '&select=id,owner_uid,data&limit=1';
  const headers = {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  for (let i = 0; i < FIND_TRIES; i++) {
    try {
      const r = await fetch(url, { headers: headers });
      if (r.ok) {
        const j = await r.json().catch(function () { return null; });
        if (Array.isArray(j) && j[0]) return j[0];
      }
    } catch (e) { /* tenta de novo */ }
    if (i < FIND_TRIES - 1) await sleep(FIND_DELAY_MS);
  }
  return null;
}

async function patchReuniaoData(reuniaoId, newData) {
  try {
    const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/reunioes?id=eq.' + encodeURIComponent(reuniaoId), {
      method: 'PATCH',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ data: newData })
    });
    return r.ok;
  } catch (e) { return false; }
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

  /* 2) dados da reunião (nunca auth_uid/owner_uid) */
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
    /* 3) a reunião precisa existir e ser DESTE usuário */
    const reuniao = await fetchReuniao(reuniaoId);
    if (!reuniao || reuniao.owner_uid !== authUid) return send(res, 404, { ok: false, code: 'REUNIAO_NOT_FOUND' });
    const rdata = reuniao.data || {};

    /* 4) dedup — já tem evento? */
    if (rdata.googleCalendarEventId) {
      return send(res, 409, { ok: false, code: 'ALREADY_CREATED', eventId: rdata.googleCalendarEventId });
    }

    /* 5) access_token a partir do refresh_token DESTE auth_uid */
    const at = await shared.getGoogleAccessToken(authUid);
    if (at.error === 'not_connected') return send(res, 404, { ok: false, code: 'GOOGLE_NOT_CONNECTED' });
    if (at.error === 'revoked') return send(res, 404, { ok: false, code: 'GOOGLE_REVOKED' });
    if (at.error) return send(res, 502, { ok: false, code: 'GOOGLE_ERROR' });

    /* 6) cria o evento no PRIMARY dessa conta (sem attendees / convites) */
    const evt = shared.buildEventResource({ titulo: titulo, data: data, horaInicio: horaInicio, horaFim: horaFim, observacoes: observacoes, leadNome: leadNome, leadTelefone: leadTelefone });
    let gr, gj;
    try {
      gr = await fetch(GOOGLE_EVENTS_URL, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + at.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify(evt)
      });
      gj = await gr.json().catch(function () { return null; });
    } catch (e) {
      console.error('[gcal create-event] rede ao criar evento');
      return send(res, 502, { ok: false, code: 'GOOGLE_API_ERROR' });
    }
    if (!gr.ok || !gj || !gj.id) {
      console.error('[gcal create-event] Google recusou o evento — http', gr && gr.status);
      return send(res, 502, { ok: false, code: 'GOOGLE_API_ERROR' });
    }
    const eventId = gj.id;

    /* 7) vincula o evento à reunião (o frontend também grava — idempotente) */
    const newData = Object.assign({}, rdata, { googleCalendarEventId: eventId, googleCalendarStatus: 'created' });
    await patchReuniaoData(reuniaoId, newData);

    /* e-mail da conta Google, sem escopo extra (vem na resposta do evento) */
    const gmail = (gj.organizer && gj.organizer.email) || (gj.creator && gj.creator.email) || null;
    if (gmail) await shared.setGoogleEmailIfEmpty(authUid, gmail);

    return send(res, 200, { ok: true, eventId: eventId });
  } catch (e) {
    console.error('[gcal create-event] erro interno');
    return send(res, 500, { ok: false, code: 'INTERNAL' });
  }
};
