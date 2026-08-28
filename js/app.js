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
    let logging = false;
    async function tryLogin() {
      if (logging) return;                 // evita envio duplo enquanto aguarda o Supabase
      logging = true;
      err.textContent = '';
      try {
        const r = await Auth.login(email.value, senha.value);
        if (!r.ok) { err.textContent = r.msg; return; }
        await Store.hydrate();          // carrega os dados do usuário ANTES de mostrar o CRM
        mounted = false;
        location.hash = 'dashboard';
        boot();                         // boot() decide entre CRM e tela de erro conforme Store._mode()
      } finally {
        logging = false;
      }
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
    el.querySelector('#logout').onclick = async function () {
      await Auth.logout();
      Store.clear();                    // descarta o cache do usuário que saiu
      mounted = false; location.hash = ''; boot();
    };
    return el;
  }

  /* ---------------- TELA DE ERRO (Supabase indisponível) ---------------- */
  function errorScreen() {
    const wrap = U.el('<div class="login-wrap err-screen"><div class="login-card">' +
      '<div class="login-logo"><span class="brand-logo"><img src="logo.png" alt="LFT" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline\'"><span class="brand-fallback" style="display:none">LFT</span></span></div>' +
      '<h1>Sem conexão com o servidor</h1>' +
      '<p class="muted">Não foi possível carregar os dados do CRM agora. Seus dados continuam guardados no servidor — nada foi perdido. Nenhuma alteração pode ser salva enquanto isto não for resolvido.</p>' +
      '<div class="login-err" id="err"></div>' +
      '<button class="btn primary block" id="retry">Tentar novamente</button>' +
      '<button class="btn ghost block" id="sair" style="margin-top:8px">Sair</button>' +
      '</div></div>');

    const retry = wrap.querySelector('#retry'), err = wrap.querySelector('#err');
    let trying = false;
    retry.onclick = async function () {
      if (trying) return;
      trying = true; retry.disabled = true; err.textContent = '';
      try { await Store.hydrate(); }
      catch (e) { /* Store.hydrate() já avisa o usuário */ }
      finally { trying = false; retry.disabled = false; }
      boot();
    };
    wrap.querySelector('#sair').onclick = async function () {
      await Auth.logout();
      Store.clear();
      mounted = false; location.hash = ''; boot();
    };
    return wrap;
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
      if (!app.querySelector('#go')) {   // não recria a tela de login já visível (evita perder foco/erro)
        app.innerHTML = '';
        app.appendChild(loginScreen());
      }
      mounted = false;
      return;
    }
    if (Store._mode && Store._mode() === 'error') {   // Supabase indisponível: não fingir que o CRM está normal
      if (!app.querySelector('.err-screen')) {
        app.innerHTML = '';
        app.appendChild(errorScreen());
      }
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

  /* Junta chamadas de boot vindas de listeners (auth / refresh de token) numa só por tick.
     Fica inerte até Auth.ready() + Store.ready() — assim nada renderiza antes da 1ª hidratação. */
  let bootQueued = false, appReady = false;
  function scheduleBoot() {
    if (!appReady || bootQueued) return;
    bootQueued = true;
    Promise.resolve().then(function () { bootQueued = false; boot(); });
  }

  /* Re-renderiza quando a sessão do Supabase muda (login/logout em outra aba, refresh de token) */
  Auth.onChange(scheduleBoot);

  /* Só decide entre CRM e tela de login depois que o Supabase restaurou a sessão existente */
  (async function () {
    await Auth.ready();
    await Store.ready();   // só decide entre CRM / login / erro depois que o cache foi hidratado
    appReady = true;
    scheduleBoot();
  })();
})();
