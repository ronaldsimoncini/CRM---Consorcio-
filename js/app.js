/* Shell do CRM: login, menu lateral, topo e roteamento */
(function () {
  const LABELS = {
    dashboard: 'Dashboard', leads: 'Leads', funil: 'Funil', simulacoes: 'Simulações',
    propostas: 'Propostas', vendas: 'Vendas', metas: 'Metas',
    consultores: 'Consultores', relatorios: 'Relatórios', config: 'Configurações'
  };
  const ICONS = {
    dashboard: '📊', leads: '🧑', funil: '🗂️', simulacoes: '🧮', propostas: '📄', vendas: '💰',
    metas: '🎯', consultores: '👥', relatorios: '📈', config: '⚙️'
  };
  let mounted = false;

  function currentRoute() {
    const h = (location.hash || '').replace('#', '');
    return Auth.menu().indexOf(h) >= 0 ? h : 'dashboard';
  }

  /* ---------------- LOGIN ---------------- */
  function loginScreen() {
    const wrap = U.el('<div class="login-wrap"><div class="login-card">' +
      '<div class="login-logo"><span class="brand-logo"><img src="logo.png" alt="LFT" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline\'"><span class="brand-fallback" style="display:none">LFT</span></span></div>' +
      '<h1>' + U.esc(Store.config().empresa) + '</h1>' +
      '<p class="muted">Acesse o CRM</p>' +
      '<label class="field"><span>E-mail</span><input id="email" type="email" autocomplete="username"></label>' +
      '<label class="field"><span>Senha</span><input id="senha" type="password" autocomplete="current-password"></label>' +
      '<div class="login-err" id="err"></div>' +
      '<button class="btn primary block" id="go">Entrar</button>' +
      '<div class="muted login-hint">Primeiro acesso do administrador:<br><b>relacionamento@lftgestaoderisco.com.br</b> / senha <b>admin123</b><br>(altere depois em Configurações → Usuários)</div>' +
      '</div></div>');

    const email = wrap.querySelector('#email'), senha = wrap.querySelector('#senha'), err = wrap.querySelector('#err');
    function tryLogin() {
      const r = Auth.login(email.value, senha.value);
      if (!r.ok) { err.textContent = r.msg; return; }
      mounted = false;
      location.hash = 'dashboard';
      boot();
    }
    wrap.querySelector('#go').onclick = tryLogin;
    [email, senha].forEach(function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryLogin(); }); });
    setTimeout(function () { email.focus(); }, 50);
    return wrap;
  }

  /* ---------------- SHELL ---------------- */
  function shell() {
    const u = Auth.user();
    const items = Auth.menu().map(function (r) {
      return '<button class="nav-item" data-route="' + r + '"><span class="nav-ic">' + ICONS[r] + '</span><span>' + LABELS[r] + '</span></button>';
    }).join('');

    const el = U.el(
      '<div class="shell">' +
      '<div class="nav-backdrop"></div>' +
      '<aside class="sidebar">' +
        '<div class="sb-brand"><span class="brand-logo"><img src="logo.png" alt="LFT" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline\'"><span class="brand-fallback" style="display:none">LFT</span></span>' +
        '<span class="sb-emp">' + U.esc(Store.config().empresa) + '</span></div>' +
        '<nav class="nav">' + items + '</nav>' +
      '</aside>' +
      '<div class="main">' +
        '<header class="topbar">' +
          '<button class="hamb" aria-label="Menu">☰</button>' +
          '<div class="tb-title" id="tb-title">Dashboard</div>' +
          '<div class="tb-user"><div class="tb-name">' + U.esc(u.nome) + '<span class="tb-nivel">' + u.nivel + '</span></div>' +
          '<button class="btn ghost sm" id="logout">Sair</button></div>' +
        '</header>' +
        '<main class="content" id="view"></main>' +
      '</div>' +
      '</div>'
    );

    el.querySelectorAll('.nav-item').forEach(function (b) {
      b.onclick = function () { location.hash = b.dataset.route; el.classList.remove('nav-open'); };
    });
    el.querySelector('.hamb').onclick = function () { el.classList.toggle('nav-open'); };
    el.querySelector('.nav-backdrop').onclick = function () { el.classList.remove('nav-open'); };
    el.querySelector('#logout').onclick = function () {
      Auth.logout(); mounted = false; location.hash = ''; boot();
    };
    return el;
  }

  function renderRoute() {
    const route = currentRoute();
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.dataset.route === route);
    });
    const t = document.getElementById('tb-title');
    if (t) t.textContent = LABELS[route] || '';
    const view = document.getElementById('view');
    if (!view) return;
    view.innerHTML = '';
    try {
      (Views[route] || Views.dashboard)(view);
    } catch (e) {
      console.error(e);
      view.innerHTML = '<div class="card"><b>Erro ao carregar esta tela.</b><div class="muted">' + U.esc(String(e && e.message || e)) + '</div></div>';
    }
    view.scrollTop = 0;
  }

  function boot() {
    const app = document.getElementById('app');
    if (!Auth.user()) {
      app.innerHTML = '';
      app.appendChild(loginScreen());
      mounted = false;
      return;
    }
    if (!mounted) {
      app.innerHTML = '';
      app.appendChild(shell());
      mounted = true;
    }
    renderRoute();
  }

  window.addEventListener('hashchange', function () {
    if (Auth.user() && mounted) renderRoute();
    else boot();
  });

  Store.subscribe(function () {
    if (Auth.user() && mounted) renderRoute();
    else boot();
  });

  boot();
})();
