/* Helpers compartilhados da integração com o Google Calendar (Fase 1).
 * O nome começa com "_" para a Vercel NÃO tratar este arquivo como rota.
 *
 * Node >= 18: fetch / Buffer / URLSearchParams nativos. crypto via require.
 * Segredos vêm SEMPRE de process.env — nunca são retornados nem logados.
 */
'use strict';

const crypto = require('crypto');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/* Único escopo desta fase: ver e criar eventos. Sem openid / email. */
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/* Validade curta do state (~10 min). */
const STATE_TTL_SECONDS = 600;

/* ---------- base64url ---------- */
function b64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

/* ---------- HMAC ---------- */
function hmac(data, secret) {
  return crypto.createHmac('sha256', String(secret)).update(String(data)).digest();
}
function safeEqual(a, b) {
  const ba = Buffer.isBuffer(a) ? a : Buffer.from(String(a));
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch (e) { return false; }
}

/* ---------- state assinado ---------- */
/* payloadObj: { auth_uid, iat, exp } */
function signState(payloadObj, secret) {
  const payload = b64urlEncode(JSON.stringify(payloadObj));
  const sig = b64urlEncode(hmac(payload, secret));
  return payload + '.' + sig;
}
function verifyState(state, secret) {
  if (typeof state !== 'string') return null;
  const dot = state.indexOf('.');
  if (dot <= 0) return null;
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = b64urlEncode(hmac(payload, secret));
  if (!safeEqual(sig, expected)) return null;
  let obj;
  try { obj = JSON.parse(b64urlDecode(payload).toString('utf8')); } catch (e) { return null; }
  if (!obj || typeof obj.auth_uid !== 'string' || !obj.exp) return null;
  if (Math.floor(Date.now() / 1000) > Number(obj.exp)) return null;
  return obj;
}

/* ---------- identidade do usuário logado (Supabase) ---------- */
function bearerToken(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}
async function getUserFromToken(req) {
  const token = bearerToken(req);
  if (!token) return { error: 'no_token' };
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { error: 'not_configured' };
  let r;
  try {
    r = await fetch(url + '/auth/v1/user', { headers: { apikey: anon, Authorization: 'Bearer ' + token } });
  } catch (e) { return { error: 'network' }; }
  if (r.status === 401 || r.status === 403) return { error: 'expired' };
  if (!r.ok) return { error: 'error' };
  const j = await r.json().catch(function () { return null; });
  if (!j || typeof j.id !== 'string') return { error: 'error' };
  return { auth_uid: j.id };
}

/* ---------- Google OAuth ---------- */
function buildConsentUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: state
  });
  return GOOGLE_AUTH_URL + '?' + params.toString();
}

/* Troca o authorization code pelos tokens.
   Retorna { tokens: { access_token, refresh_token?, expires_in, scope, token_type } }
   ou { error: '<código>' }.  Nunca loga tokens. */
async function exchangeCode(code) {
  const body = new URLSearchParams({
    code: code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code'
  });
  let r;
  try {
    r = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString()
    });
  } catch (e) { return { error: 'network' }; }
  const j = await r.json().catch(function () { return null; });
  if (!r.ok || !j || !j.access_token) {
    return { error: (j && j.error) || ('http_' + r.status) }; // j.error = código OAuth do Google, nunca um token
  }
  return { tokens: j };
}

/* =========================================================================
 *  FASE 2 — persistência da conexão + access_token + evento
 *  Tudo abaixo usa SOMENTE a SUPABASE_SERVICE_ROLE_KEY (backend).
 *  O refresh_token NUNCA é retornado para quem chama — só é usado aqui
 *  internamente para falar com o Google. Nada disso vai para log.
 * ========================================================================= */

const TIMEZONE = 'America/Sao_Paulo';
const TOKENS_TABLE = 'google_calendar_tokens';

function restBase() { return process.env.SUPABASE_URL + '/rest/v1'; }
function serviceHeaders(extra) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Object.assign({ apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, extra || {});
}

/* Lê a linha de tokens do usuário. `cols` = colunas do select.
   O valor de refresh_token só circula dentro deste módulo. */
async function getGoogleTokenRow(auth_uid, cols) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: 'not_configured' };
  const url = restBase() + '/' + TOKENS_TABLE + '?auth_uid=eq.' + encodeURIComponent(auth_uid) +
    '&select=' + encodeURIComponent(cols || 'auth_uid') + '&limit=1';
  let r;
  try { r = await fetch(url, { headers: serviceHeaders() }); }
  catch (e) { return { error: 'db_network' }; }
  if (!r.ok) return { error: 'db_error' };
  const j = await r.json().catch(function () { return null; });
  if (!Array.isArray(j)) return { error: 'db_error' };
  return { row: j[0] || null };
}

/* persistTokens real:
   - com refresh_token novo  -> UPSERT (merge por auth_uid);
   - sem refresh_token (reconexão) e já existe linha -> mantém o token atual,
     atualiza só o scope (NUNCA zera o refresh_token existente);
   - sem refresh_token e sem linha -> erro 'no_refresh_token';
   connected_at é preservado (default no 1º insert; não reenviado no merge);
   updated_at é atualizado pelo trigger da tabela. */
async function upsertGoogleTokens(auth_uid, tokens) {
  if (!auth_uid) return { error: 'no_auth_uid' };
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: 'not_configured' };
  const refresh = tokens && tokens.refresh_token;
  const scope = (tokens && tokens.scope) || SCOPE;

  if (!refresh) {
    const cur = await getGoogleTokenRow(auth_uid, 'auth_uid');
    if (cur.error) return { error: cur.error };
    if (!cur.row) return { error: 'no_refresh_token' };
    let r;
    try {
      r = await fetch(restBase() + '/' + TOKENS_TABLE + '?auth_uid=eq.' + encodeURIComponent(auth_uid), {
        method: 'PATCH',
        headers: serviceHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ scope: scope })
      });
    } catch (e) { return { error: 'db_network' }; }
    return r.ok ? { ok: true, kept: true } : { error: 'db_error' };
  }

  let r;
  try {
    r = await fetch(restBase() + '/' + TOKENS_TABLE, {
      method: 'POST',
      headers: serviceHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ auth_uid: auth_uid, refresh_token: refresh, scope: scope })
    });
  } catch (e) { return { error: 'db_network' }; }
  return r.ok ? { ok: true } : { error: 'db_error' };
}

/* Preenche google_email só se ainda estiver nulo. Silencioso (não crítico). */
async function setGoogleEmailIfEmpty(auth_uid, email) {
  if (!auth_uid || !email) return;
  try {
    await fetch(restBase() + '/' + TOKENS_TABLE + '?auth_uid=eq.' + encodeURIComponent(auth_uid) + '&google_email=is.null', {
      method: 'PATCH',
      headers: serviceHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ google_email: String(email) })
    });
  } catch (e) { /* silencioso */ }
}

async function deleteGoogleTokens(auth_uid) {
  if (!auth_uid) return;
  try {
    await fetch(restBase() + '/' + TOKENS_TABLE + '?auth_uid=eq.' + encodeURIComponent(auth_uid), {
      method: 'DELETE',
      headers: serviceHeaders({ Prefer: 'return=minimal' })
    });
  } catch (e) { /* silencioso */ }
}

/* Status para o endpoint /status. NUNCA devolve refresh_token. */
async function getGoogleConnection(auth_uid) {
  const res = await getGoogleTokenRow(auth_uid, 'google_email');
  if (res.error) return { error: res.error };
  if (!res.row) return { connected: false };
  const out = { connected: true };
  if (res.row.google_email) out.google_email = res.row.google_email;
  return out;
}

/* access_token a partir do refresh_token salvo. Uso interno na requisição.
   Retorna { access_token } ou { error: 'not_connected'|'revoked'|'google_error'|'db_error'|... }.
   Em invalid_grant (token revogado) apaga a linha morta. */
async function getGoogleAccessToken(auth_uid) {
  const res = await getGoogleTokenRow(auth_uid, 'refresh_token');
  if (res.error) return { error: res.error };
  if (!res.row || !res.row.refresh_token) return { error: 'not_connected' };

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: res.row.refresh_token,
    grant_type: 'refresh_token'
  });
  let r;
  try {
    r = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString()
    });
  } catch (e) { return { error: 'google_error' }; }
  const j = await r.json().catch(function () { return null; });
  if (!r.ok || !j || !j.access_token) {
    if (j && j.error === 'invalid_grant') {
      await deleteGoogleTokens(auth_uid);
      return { error: 'revoked' };
    }
    return { error: 'google_error' };
  }
  return { access_token: j.access_token };
}

/* =========================================================================
 *  FASE 3a — sincronização CRM → Google para EDIÇÃO e CANCELAMENTO
 *  Nunca cria evento novo aqui: só age sobre um googleCalendarEventId existente.
 * ========================================================================= */

const GOOGLE_CALENDAR_EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/* Lê a reunião pelo id (SERVICE ROLE). Pequeno retry por segurança. */
async function getReuniao(reuniaoId) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: 'not_configured' };
  const url = restBase() + '/reunioes?id=eq.' + encodeURIComponent(reuniaoId) + '&select=id,owner_uid,data&limit=1';
  for (let i = 0; i < 3; i++) {
    let r = null;
    try { r = await fetch(url, { headers: serviceHeaders() }); } catch (e) { r = null; }
    if (r && r.ok) {
      const j = await r.json().catch(function () { return null; });
      if (Array.isArray(j)) return { row: j[0] || null };
    }
    if (i < 2) await new Promise(function (res) { setTimeout(res, 300); });
  }
  return { error: 'db_error' };
}

/* Grava data (JSONB) da reunião (SERVICE ROLE). owner_uid não é tocado. */
async function patchReuniaoData(reuniaoId, newData) {
  try {
    const r = await fetch(restBase() + '/reunioes?id=eq.' + encodeURIComponent(reuniaoId), {
      method: 'PATCH',
      headers: serviceHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ data: newData })
    });
    return r.ok;
  } catch (e) { return false; }
}

/* PATCH de um evento no primary. Retorna:
   { ok:true, event } | { gone:true } (404/410) | { error:'http_<n>'|'network' } */
async function patchGoogleEvent(accessToken, eventId, patchBody) {
  let r;
  try {
    r = await fetch(GOOGLE_CALENDAR_EVENTS + '/' + encodeURIComponent(eventId), {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody)
    });
  } catch (e) { return { error: 'network' }; }
  if (r.status === 404 || r.status === 410) return { gone: true };
  const j = await r.json().catch(function () { return null; });
  if (!r.ok || !j || !j.id) return { error: 'http_' + r.status };
  return { ok: true, event: j };
}

/* DELETE de um evento no primary. Retorna:
   { ok:true } | { gone:true } (404/410 — já removido) | { error:'http_<n>'|'network' } */
async function deleteGoogleEvent(accessToken, eventId) {
  let r;
  try {
    r = await fetch(GOOGLE_CALENDAR_EVENTS + '/' + encodeURIComponent(eventId), {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + accessToken }
    });
  } catch (e) { return { error: 'network' }; }
  if (r.status === 404 || r.status === 410) return { gone: true };
  if (r.ok || r.status === 204) return { ok: true };
  return { error: 'http_' + r.status };
}

/* Monta o corpo do evento do Google Calendar (sem attendees / convites). */
function buildEventResource(f) {
  const desc = [];
  if (f.observacoes) desc.push(String(f.observacoes));
  if (f.leadNome) desc.push('Lead: ' + String(f.leadNome) + (f.leadTelefone ? ' — ' + String(f.leadTelefone) : ''));
  return {
    summary: String(f.titulo || 'Reunião'),
    description: desc.join('\n\n'),
    start: { dateTime: f.data + 'T' + f.horaInicio + ':00', timeZone: TIMEZONE },
    end: { dateTime: f.data + 'T' + f.horaFim + ':00', timeZone: TIMEZONE }
  };
}

module.exports = {
  SCOPE: SCOPE,
  STATE_TTL_SECONDS: STATE_TTL_SECONDS,
  TIMEZONE: TIMEZONE,
  b64urlEncode: b64urlEncode,
  b64urlDecode: b64urlDecode,
  hmac: hmac,
  signState: signState,
  verifyState: verifyState,
  getUserFromToken: getUserFromToken,
  buildConsentUrl: buildConsentUrl,
  exchangeCode: exchangeCode,
  /* Fase 2 */
  upsertGoogleTokens: upsertGoogleTokens,
  getGoogleConnection: getGoogleConnection,
  getGoogleAccessToken: getGoogleAccessToken,
  setGoogleEmailIfEmpty: setGoogleEmailIfEmpty,
  deleteGoogleTokens: deleteGoogleTokens,
  buildEventResource: buildEventResource,
  /* Fase 3a */
  getReuniao: getReuniao,
  patchReuniaoData: patchReuniaoData,
  patchGoogleEvent: patchGoogleEvent,
  deleteGoogleEvent: deleteGoogleEvent
};
