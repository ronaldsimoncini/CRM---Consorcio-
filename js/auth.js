/* Login, sessão e permissões — via Supabase Auth (modo nuvem).
   O login local por localStorage foi substituído por supabase.auth.*.
   A relação com a tabela `usuarios` é feita por usuarios.auth_uid = auth.uid(). */
window.Auth = (function () {

  /* ---------- cliente Supabase (compartilhável com o store.js na próxima etapa) ---------- */
  let _client = null;
  function client() {
    if (_client) return _client;
    const cfg = window.CRM_CONFIG || {};
    if (!window.supabase || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      console.error('Supabase indisponível: verifique o config.js e o script @supabase/supabase-js no index.html.');
      return null;
    }
    _client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'crm_sb_auth' }
    });
    return _client;
  }

  /* ---------- estado em memória (a autenticação NÃO usa localStorage próprio) ---------- */
  let currentUser = null;   // linha de `usuarios` achatada: { id, nome, email, nivel, status, ... }
  let currentUid = null;    // auth.uid() do Supabase
  let _ready = false;
  let _resolveReady;
  const _readyPromise = new Promise(function (r) { _resolveReady = r; });
  const _subs = [];

  function onChange(fn) { if (typeof fn === 'function') _subs.push(fn); }
  function emit() { _subs.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } }); }

  /* Busca em `usuarios` a linha cujo auth_uid == uid.
     O RLS libera a leitura assim que o usuário está autenticado e ativo (is_agency_user()). */
  async function carregarPerfil(uid) {
    const c = client();
    if (!c || !uid) return null;
    const res = await c.from('usuarios').select('id, auth_uid, data').eq('auth_uid', uid).maybeSingle();
    if (res.error) { console.error('Falha ao carregar o perfil do usuário:', res.error.message); return null; }
    if (!res.data) return null;
    return Object.assign({ id: res.data.id }, res.data.data || {});
  }

  async function sincronizarSessao() {
    const c = client();
    if (!c) { currentUser = null; currentUid = null; return; }
    const r = await c.auth.getSession();
    const session = r && r.data ? r.data.session : null;
    if (!session || !session.user) { currentUser = null; currentUid = null; return; }
    currentUid = session.user.id;
    currentUser = await carregarPerfil(currentUid);
  }

  /* Inicialização: restaura a sessão existente (se houver) e passa a ouvir mudanças. */
  (async function init() {
    try { await sincronizarSessao(); }
    catch (e) { console.error('Erro ao iniciar a sessão do Supabase:', e); }

    const c = client();
    if (c) {
      c.auth.onAuthStateChange(function (_evento, session) {
        (async function () {
          try {
            if (session && session.user) {
              currentUid = session.user.id;
              currentUser = await carregarPerfil(currentUid);
            } else {
              currentUid = null; currentUser = null;
            }
          } catch (e) { console.error(e); }
          emit();
        })();
      });
    }

    _ready = true;
    _resolveReady();
    emit();
  })();

  /* ---------- login / logout (assíncronos — usam supabase.auth) ---------- */
  async function login(email, senha) {
    const c = client();
    if (!c) return { ok: false, msg: 'Configuração da nuvem ausente. Verifique o config.js.' };

    let res;
    try {
      res = await c.auth.signInWithPassword({
        email: String(email || '').trim().toLowerCase(),
        password: String(senha || '')
      });
    } catch (e) {
      return { ok: false, msg: 'Sem conexão com o servidor. Tente novamente.' };
    }

    if (res.error) {
      const m = res.error.message || '';
      if (/invalid login credentials/i.test(m)) return { ok: false, msg: 'E-mail ou senha incorretos.' };
      if (/email not confirmed/i.test(m))       return { ok: false, msg: 'E-mail ainda não confirmado no Supabase.' };
      if (/rate limit|too many/i.test(m))       return { ok: false, msg: 'Muitas tentativas. Aguarde um instante e tente de novo.' };
      return { ok: false, msg: 'Não foi possível entrar: ' + m };
    }

    currentUid = res.data.user.id;
    currentUser = await carregarPerfil(currentUid);

    if (!currentUser) {
      await sair(c);
      return { ok: false, msg: 'Login válido, mas este e-mail não está cadastrado na tabela de usuários do CRM.' };
    }
    if (currentUser.status === 'bloqueado') { await sair(c); return { ok: false, msg: 'Usuário bloqueado. Fale com o administrador.' }; }
    if (currentUser.status === 'inativo')   { await sair(c); return { ok: false, msg: 'Usuário inativo. Fale com o administrador.' }; }

    return { ok: true };
  }

  async function sair(c) {
    try { await (c || client()).auth.signOut(); } catch (e) { console.error(e); }
    currentUser = null; currentUid = null;
  }
  async function logout() { await sair(); emit(); }

  /* ---------- administração de usuários (via função serverless) ----------
     Envia o access_token da sessão (JWT do admin) no header Authorization.
     A service_role key vive SÓ no servidor; o navegador nunca a vê. */
  async function adminApi(action, payload) {
    const c = client();
    if (!c) return { ok: false, msg: 'Configuração da nuvem ausente.' };
    let token = null;
    try {
      const s = await c.auth.getSession();
      token = s && s.data && s.data.session && s.data.session.access_token;
    } catch (e) { /* ignora */ }
    if (!token) return { ok: false, msg: 'Sua sessão expirou. Entre novamente.' };

    const base = (window.CRM_CONFIG && window.CRM_CONFIG.painelApiBase) || '';
    let res, body;
    try {
      res = await fetch(base + '/api/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(Object.assign({ action: action }, payload || {}))
      });
      body = await res.json().catch(function () { return {}; });
    } catch (e) {
      return { ok: false, msg: 'Sem conexão com o servidor. Tente novamente.' };
    }
    if (!res.ok || !body || body.ok !== true) {
      return {
        ok: false,
        msg: (body && (body.error || body.msg)) || ('Erro no servidor (' + res.status + ').'),
        inconsistent: !!(body && body.inconsistent),
        authUid: body && body.authUid
      };
    }
    return { ok: true, data: body };
  }

  /* ---------- Google Calendar: inicia o fluxo OAuth (Fase 1) ----------
     Pega o access_token da sessão, chama GET /api/google-calendar/auth e
     redireciona o navegador para a URL de consentimento do Google.
     Sucesso => o navegador sai desta página. Falha => { ok:false, msg }. */
  async function googleCalendarConnect() {
    const c = client();
    if (!c) return { ok: false, msg: 'Configuração da nuvem ausente.' };
    let token = null;
    try {
      const s = await c.auth.getSession();
      token = s && s.data && s.data.session && s.data.session.access_token;
    } catch (e) { /* ignora */ }
    if (!token) return { ok: false, msg: 'Sua sessão expirou. Entre novamente.' };

    const base = (window.CRM_CONFIG && window.CRM_CONFIG.painelApiBase) || '';
    try {
      const res = await fetch(base + '/api/google-calendar/auth', {
        headers: { Authorization: 'Bearer ' + token }
      });
      const body = await res.json().catch(function () { return {}; });
      if (!res.ok || !body || !body.url) {
        return { ok: false, msg: (body && body.error) || ('Erro no servidor (' + res.status + ').') };
      }
      window.location.assign(body.url);
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: 'Sem conexão com o servidor. Tente novamente.' };
    }
  }

  /* ---------- leitura de sessão / permissões (API pública síncrona preservada) ---------- */
  function user() {
    if (!currentUser || currentUser.status !== 'ativo') return null;
    return currentUser;
  }
  function currentId() { return currentUser ? currentUser.id : null; }
  function nivel() { const u = user(); return u ? u.nivel : null; }
  function isAdmin() { return nivel() === 'admin'; }
  function isGestor() { return nivel() === 'gestor'; }
  function isConsultor() { return nivel() === 'consultor'; }
  function canSeeAll() { return isAdmin() || isGestor(); }
  function canEdit() { return isAdmin() || isConsultor(); } /* gestor é somente leitura */

  /* Um registro pertence ao usuário logado?
     Critério principal: owner_uid === auth.uid() (o mesmo que o RLS usará).
     Fallback: registros SEM owner_uid (legado / os 25 leads antigos) usam o
     campo de negócio (consultorId por padrão) — assim nada muda no que já existe. */
  function owns(rec, campo) {
    if (!rec) return false;
    if (rec.owner_uid != null) return rec.owner_uid === currentUid;
    return rec[campo || 'consultorId'] === currentId();
  }

  /* Filtra uma lista de leads/propostas/vendas conforme o nível.
     admin/gestor: vê tudo (comportamento atual preservado).
     consultor: vê só o que é seu, por owner_uid (com fallback para o campo de negócio). */
  function scope(list, campo) {
    if (canSeeAll()) return list;
    return list.filter(function (x) { return owns(x, campo); });
  }

  function menu() {
    const base = ['dashboard', 'leads', 'funil', 'simulacoes', 'propostas', 'vendas', 'metas'];
    if (isConsultor()) return base;
    if (isGestor()) return base.concat(['consultores', 'relatorios']);
    return base.concat(['consultores', 'relatorios', 'config']); /* admin */
  }

  return {
    user: user, login: login, logout: logout, nivel: nivel,
    isAdmin: isAdmin, isGestor: isGestor, isConsultor: isConsultor,
    canSeeAll: canSeeAll, canEdit: canEdit, scope: scope, owns: owns, menu: menu,
    currentId: currentId, adminApi: adminApi, googleCalendarConnect: googleCalendarConnect,
    uid: function () { return currentUid; },   /* auth.uid() da sessão atual (para owner_uid) */
    /* utilitários para a próxima etapa (app.js / store.js) */
    ready: function () { return _readyPromise; },
    isReady: function () { return _ready; },
    onChange: onChange,
    client: client
  };
})();
