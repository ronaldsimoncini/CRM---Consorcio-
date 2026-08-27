/* Login, sessão e permissões */
window.Auth = (function () {
  const SKEY = 'crm_session_v1';
  let currentId = null;
  try { currentId = localStorage.getItem(SKEY) || null; } catch (e) { currentId = null; }

  function user() {
    if (!currentId) return null;
    const u = Store.get('usuarios', currentId);
    if (!u || u.status !== 'ativo') return null;
    return u;
  }

  function login(email, senha) {
    const u = Store.all('usuarios').find(function (x) {
      return (x.email || '').toLowerCase() === String(email).toLowerCase().trim();
    });
    if (!u) return { ok: false, msg: 'E-mail não encontrado.' };
    if (u.senha !== senha) return { ok: false, msg: 'Senha incorreta.' };
    if (u.status === 'bloqueado') return { ok: false, msg: 'Usuário bloqueado. Fale com o administrador.' };
    if (u.status === 'inativo') return { ok: false, msg: 'Usuário inativo. Fale com o administrador.' };
    currentId = u.id;
    try { localStorage.setItem(SKEY, u.id); } catch (e) {}
    Store.update('usuarios', u.id, { ultimoAcesso: U.nowISO() });
    return { ok: true };
  }

  function logout() {
    currentId = null;
    try { localStorage.removeItem(SKEY); } catch (e) {}
  }

  function nivel() { const u = user(); return u ? u.nivel : null; }
  function isAdmin() { return nivel() === 'admin'; }
  function isGestor() { return nivel() === 'gestor'; }
  function isConsultor() { return nivel() === 'consultor'; }
  function canSeeAll() { return isAdmin() || isGestor(); }
  function canEdit() { return isAdmin() || isConsultor(); } /* gestor é somente leitura */

  /* Filtra uma lista de leads/propostas/vendas conforme o nível */
  function scope(list, campo) {
    campo = campo || 'consultorId';
    if (canSeeAll()) return list;
    return list.filter(function (x) { return x[campo] === currentId; });
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
    canSeeAll: canSeeAll, canEdit: canEdit, scope: scope, menu: menu,
    currentId: function () { return currentId; }
  };
})();
