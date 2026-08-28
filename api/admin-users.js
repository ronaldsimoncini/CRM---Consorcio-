/* Função serverless (Vercel):  POST /api/admin-users
 * -------------------------------------------------------------------------
 * Cria usuários do CRM (login no Supabase Auth + registro em public.usuarios)
 * e vincula um login existente a um cadastro pendente.
 *
 * SEGURANÇA
 *  - A SUPABASE_SERVICE_ROLE_KEY existe SOMENTE aqui (process.env). Nunca é
 *    enviada ao navegador, nem retornada, nem logada.
 *  - Toda chamada exige o JWT de um ADMINISTRADOR. A validação é feita no
 *    servidor chamando a função public.is_admin() com esse JWT.
 *  - A senha digitada é usada só para criar o usuário no Auth. NUNCA é salva
 *    em public.usuarios.data.senha, nem logada, nem retornada.
 *
 * VARIÁVEIS DE AMBIENTE (Vercel → Project → Settings → Environment Variables)
 *  - SUPABASE_URL                 (já usada por api/painel.js)
 *  - SUPABASE_SERVICE_ROLE_KEY    (já usada por api/painel.js — SEGREDO)
 *  - SUPABASE_ANON_KEY            (NOVA — chave pública; usada só para chamar
 *                                  rpc/is_admin com o JWT do administrador)
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const NIVEIS = ['admin', 'gestor', 'consultor'];
const STATUSES = ['ativo', 'inativo', 'bloqueado'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Método não permitido.' });

  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return send(res, 500, { ok: false, error: 'Servidor não configurado (variáveis de ambiente ausentes).' });
  }

  const token = bearer(req);
  if (!token) return send(res, 401, { ok: false, error: 'Sua sessão não foi enviada. Entre novamente.' });

  // ---- validação do ADMINISTRADOR (server-side, via public.is_admin()) ----
  const adm = await callIsAdmin(token);
  if (adm === 'expired') return send(res, 401, { ok: false, error: 'Sua sessão expirou. Entre novamente.' });
  if (adm === 'error') return send(res, 502, { ok: false, error: 'Não foi possível validar a sua permissão agora. Tente de novo.' });
  if (adm !== true) return send(res, 403, { ok: false, error: 'Você não tem permissão para gerenciar usuários.' });

  const body = await readBody(req);
  const action = body && body.action;

  try {
    if (action === 'create') return await handleCreate(res, body);
    if (action === 'link') return await handleLink(res, body);
    return send(res, 400, { ok: false, error: 'Ação inválida.' });
  } catch (e) {
    return send(res, 500, { ok: false, error: 'Erro inesperado no servidor.' });
  }
};

/* ========================= ações ========================= */

async function handleCreate(res, body) {
  const nome = str(body.nome).trim();
  const email = str(body.email).trim().toLowerCase();
  const senha = str(body.senha);
  const nivel = str(body.nivel);
  const status = STATUSES.indexOf(body.status) >= 0 ? body.status : 'ativo';
  const telefone = str(body.telefone).trim();
  const cargo = str(body.cargo).trim();

  if (!nome) return send(res, 400, { ok: false, error: 'Informe o nome.' });
  if (!EMAIL_RE.test(email)) return send(res, 400, { ok: false, error: 'E-mail inválido.' });
  if (senha.length < 6) return send(res, 400, { ok: false, error: 'A senha precisa ter ao menos 6 caracteres.' });
  if (NIVEIS.indexOf(nivel) < 0) return send(res, 400, { ok: false, error: 'Nível de acesso inválido.' });

  // ---- conflito em public.usuarios ----
  const usuarios = await getUsuarios();
  if (usuarios === null) return send(res, 502, { ok: false, error: 'Não foi possível consultar os usuários agora. Tente de novo.' });
  const jaExiste = usuarios.find(function (u) { return low(u.data && u.data.email) === email; });
  let linkId = null;
  if (jaExiste) {
    if (jaExiste.auth_uid) return send(res, 409, { ok: false, error: 'Já existe um usuário com este e-mail e login ativo.' });
    linkId = jaExiste.id; // cadastro "pendente" → vamos ativá-lo (sem duplicar)
  }

  // ---- cria o login no Supabase Auth ----
  let authUid;
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/admin/users', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email: email, password: senha, email_confirm: true, user_metadata: { nome: nome, nivel: nivel } })
    });
    const j = await r.json().catch(function () { return {}; });
    if (!r.ok) {
      const m = str(j && (j.msg || j.error_description || j.error || j.message));
      if ((j && j.code === 'email_exists') || /already.*regist|already been|email.*exist/i.test(m)) {
        return send(res, 409, { ok: false, error: 'Este e-mail já está cadastrado no login. Nenhum usuário foi criado.' });
      }
      if (/password/i.test(m)) return send(res, 400, { ok: false, error: 'Senha recusada pelo servidor de login.' });
      return send(res, 502, { ok: false, error: 'Não foi possível criar o login. Tente novamente.' });
    }
    authUid = (j && (j.id || (j.user && j.user.id))) || null;
  } catch (e) {
    return send(res, 502, { ok: false, error: 'Sem conexão com o servidor de autenticação.' });
  }
  if (!authUid) return send(res, 502, { ok: false, error: 'O login foi criado mas o servidor não retornou o identificador.' });

  // ---- grava public.usuarios ----
  const nowISO = new Date().toISOString();
  let wrote;
  if (linkId) {
    const prev = (jaExiste && jaExiste.data) || {};
    const data = Object.assign({}, prev, { nome: nome, email: email, nivel: nivel, status: status });
    if (telefone) data.telefone = telefone;
    if (cargo) data.cargo = cargo;
    if (!data.criadoEm) data.criadoEm = nowISO;
    wrote = await restWrite('PATCH', '/usuarios?id=eq.' + enc(linkId), { auth_uid: authUid, data: data });
  } else {
    const data = { nome: nome, email: email, nivel: nivel, status: status, criadoEm: nowISO, ultimoAcesso: null };
    if (telefone) data.telefone = telefone;
    if (cargo) data.cargo = cargo;
    wrote = await restWrite('POST', '/usuarios', { id: genId(), auth_uid: authUid, data: data });
  }

  // ---- erro parcial: login criado, cadastro não ----
  if (!wrote.ok) {
    const undone = await deleteAuthUser(authUid);
    if (undone) {
      return send(res, 500, { ok: false, error: 'Não foi possível salvar o cadastro. O login foi desfeito — nada foi criado. Tente novamente.' });
    }
    const comoCorrigir = linkId
      ? 'NÃO crie o usuário de novo: edite o cadastro pendente e use “Vincular login” com este uid.'
      : 'NÃO crie o usuário de novo: remova o login (uid acima) no painel do Supabase (Authentication → Users) e tente outra vez.';
    return send(res, 500, {
      ok: false, inconsistent: true, authUid: authUid,
      error: 'O login foi criado (uid ' + authUid + ') mas o cadastro não foi salvo, e não consegui desfazer o login automaticamente. ' + comoCorrigir
    });
  }

  return send(res, 200, {
    ok: true,
    usuario: { id: wrote.id || linkId, nome: nome, email: email, nivel: nivel, status: status, authUid: authUid }
  });
}

async function handleLink(res, body) {
  const usuarioId = str(body.usuarioId).trim();
  const authUid = str(body.authUid).trim();
  if (!usuarioId) return send(res, 400, { ok: false, error: 'Cadastro não informado.' });
  if (!UUID_RE.test(authUid)) return send(res, 400, { ok: false, error: 'UID de login inválido (esperado um UUID do Supabase Auth).' });

  // o UID existe no Auth?
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + enc(authUid), { headers: authHeaders() });
    if (!r.ok) return send(res, 404, { ok: false, error: 'Não encontrei esse UID no login do Supabase.' });
  } catch (e) {
    return send(res, 502, { ok: false, error: 'Sem conexão com o servidor de autenticação.' });
  }

  const usuarios = await getUsuarios();
  if (usuarios === null) return send(res, 502, { ok: false, error: 'Não foi possível consultar os usuários agora.' });

  const other = usuarios.find(function (u) { return u.auth_uid === authUid && u.id !== usuarioId; });
  if (other) return send(res, 409, { ok: false, error: 'Este login já está vinculado a outro usuário.' });

  const alvo = usuarios.find(function (u) { return u.id === usuarioId; });
  if (!alvo) return send(res, 404, { ok: false, error: 'Cadastro não encontrado.' });
  if (alvo.auth_uid && alvo.auth_uid !== authUid) return send(res, 409, { ok: false, error: 'Este cadastro já tem outro login vinculado.' });

  const wrote = await restWrite('PATCH', '/usuarios?id=eq.' + enc(usuarioId), { auth_uid: authUid });
  if (!wrote.ok) return send(res, 500, { ok: false, error: 'Não foi possível vincular o login. Tente novamente.' });
  return send(res, 200, { ok: true });
}

/* ========================= helpers ========================= */

function bearer(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

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

function str(v) { return v == null ? '' : String(v); }
function low(v) { return str(v).trim().toLowerCase(); }
function enc(v) { return encodeURIComponent(v); }
function genId() { return 'id' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

/* headers para a Admin API do Auth e para a REST — usam a SERVICE KEY (só aqui) */
function authHeaders() {
  return { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY };
}

/* Valida o solicitante como admin chamando public.is_admin() com o JWT dele.
   apikey = ANON (chave pública); Authorization = JWT do usuário. */
async function callIsAdmin(userToken) {
  let r;
  try {
    r = await fetch(SUPABASE_URL + '/rest/v1/rpc/is_admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: 'Bearer ' + userToken },
      body: '{}'
    });
  } catch (e) { return 'error'; }
  if (r.status === 401 || r.status === 403) return 'expired';
  if (!r.ok) return 'error';
  const v = await r.json().catch(function () { return null; });
  return v === true;
}

async function getUsuarios() {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/usuarios?select=id,auth_uid,data', { headers: authHeaders() });
    if (!r.ok) return null;
    const j = await r.json().catch(function () { return null; });
    return Array.isArray(j) ? j : null;
  } catch (e) { return null; }
}

async function restWrite(method, path, payload) {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1' + path, {
      method: method,
      headers: Object.assign(authHeaders(), { Prefer: 'return=representation' }),
      body: JSON.stringify(payload)
    });
    if (!r.ok) return { ok: false };
    const j = await r.json().catch(function () { return null; });
    const row = Array.isArray(j) ? j[0] : j;
    return { ok: true, id: row && row.id };
  } catch (e) { return { ok: false }; }
}

async function deleteAuthUser(authUid) {
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + enc(authUid), { method: 'DELETE', headers: authHeaders() });
    return r.ok;
  } catch (e) { return false; }
}

function send(res, code, obj) {
  return res.status(code).json(obj);
}
