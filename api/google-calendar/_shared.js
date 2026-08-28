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

module.exports = {
  SCOPE: SCOPE,
  STATE_TTL_SECONDS: STATE_TTL_SECONDS,
  b64urlEncode: b64urlEncode,
  b64urlDecode: b64urlDecode,
  hmac: hmac,
  signState: signState,
  verifyState: verifyState,
  getUserFromToken: getUserFromToken,
  buildConsentUrl: buildConsentUrl,
  exchangeCode: exchangeCode
};
