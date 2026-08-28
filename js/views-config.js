/* Configurações — somente administrador */
(function () {
  function fval(b, n) { const e = b.querySelector('[name="' + n + '"]'); return e ? String(e.value).trim() : ''; }
  function buildForm(html) { return U.el('<div class="form-grid">' + html + '</div>'); }

  /* Retorno do OAuth do Google Calendar: mostra um toast e limpa o ?gcal da URL. */
  (function () {
    try {
      const p = new URLSearchParams(location.search);
      const g = p.get('gcal');
      if (g === 'connected' || g === 'error') {
        const txt = g === 'connected'
          ? 'Google Calendar conectado com sucesso.'
          : 'Não foi possível conectar o Google Calendar. Tente de novo.';
        setTimeout(function () { if (window.C && C.toast) C.toast(txt); }, 800);
        p.delete('gcal');
        const qs = p.toString();
        history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
      }
    } catch (e) { /* ignora */ }
  })();

  const NIVEIS = [
    { value: 'admin', label: 'Administrador (acesso total)' },
    { value: 'gestor', label: 'Gestor (somente visualização)' },
    { value: 'consultor', label: 'Consultor (opera os próprios leads)' }
  ];
  const STATUS = [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }, { value: 'bloqueado', label: 'Bloqueado' }];

  Views.config = function (container) {
    if (!Auth.isAdmin()) { container.appendChild(U.el('<div class="card empty">Acesso restrito ao administrador.</div>')); return; }
    container.appendChild(U.el('<div class="page-head"><h1 class="page-title">Configurações</h1></div>'));
    const host = U.el('<div></div>');
    container.appendChild(host);

    C.tabs(host, [
      { key: 'empresa', label: 'Empresa' },
      { key: 'users', label: 'Usuários' },
      { key: 'origens', label: 'Origens' },
      { key: 'admins', label: 'Administradoras' },
      { key: 'produtos', label: 'Produtos' },
      { key: 'funil', label: 'Funil' },
      { key: 'paineltv', label: 'Painel TV' },
      { key: 'gcal', label: 'Google Calendar' },
      { key: 'dados', label: 'Backup / Dados' }
    ], function (key) {
      let pane = host.querySelector('.tabpane');
      if (!pane) { pane = U.el('<div class="tabpane"></div>'); host.appendChild(pane); }
      pane.innerHTML = '';
      ({ empresa: empresaTab, users: usersTab, origens: origensTab, admins: adminsTab, produtos: produtosTab, funil: funilTab, paineltv: painelTvTab, gcal: gcalTab, dados: dadosTab }[key])(pane);
    }, 'cfg');
  };

  function empresaTab(pane) {
    const cfg = Store.config();
    const b = buildForm(C.field('Nome da empresa', '<input name="nome" value="' + U.esc(cfg.empresa || '') + '">', true));
    pane.appendChild(b);
    pane.appendChild(U.el('<div class="muted">Logo: salve o arquivo como <b>logo.png</b> na pasta do projeto (ao lado do index.html). Ele aparece automaticamente no topo.</div>'));
    const save = U.el('<button class="btn primary" style="margin-top:12px">Salvar</button>');
    save.onclick = function () { Store.setConfig({ empresa: fval(b, 'nome') || 'Empresa' }); C.toast('Configuração salva.'); };
    pane.appendChild(save);
  }

  /* ---------- usuários ---------- */
  function userForm(u) {
    const isNew = !u;
    u = u || { nome: '', email: '', telefone: '', cargo: '', nivel: 'consultor', status: 'ativo' };
    const err = U.el('<div class="login-err" style="margin:6px 0"></div>');

    const b = buildForm(
      C.field('Nome', '<input name="nome" value="' + U.esc(u.nome) + '">', true) +
      C.field('E-mail (login)', '<input name="email" type="email" value="' + U.esc(u.email) + '"' + (isNew ? '' : ' disabled') + '>') +
      (isNew ? C.field('Senha (mín. 6 caracteres)', '<input name="senha" type="text" value="" autocomplete="new-password">') : '') +
      C.field('Telefone', '<input name="tel" value="' + U.esc(u.telefone || '') + '">') +
      C.field('Cargo', '<input name="cargo" value="' + U.esc(u.cargo || '') + '">') +
      C.field('Nível de acesso', '<select name="nivel">' + C.opts(NIVEIS, u.nivel) + '</select>') +
      C.field('Status', '<select name="status">' + C.opts(STATUS, u.status) + '</select>')
    );
    b.appendChild(err);

    if (isNew) {
      b.appendChild(U.el('<div class="field full"><span></span><div class="muted">' +
        'Ao criar, o login é gerado no Supabase e o usuário já pode entrar. A senha é usada só para criar o login — ' +
        'não fica guardada no banco.</div></div>'));
    } else {
      b.appendChild(U.el('<div class="field full"><span></span><div class="muted">' +
        'Nome, telefone, cargo, nível e status podem ser editados aqui. A troca de e-mail ou senha de um usuário ' +
        'existente ainda não é feita pelo CRM.</div></div>'));
      if (!u.authUid) {
        const linkWrap = U.el('<div class="field full"><span>Vincular login existente</span>' +
          '<div class="inline-pick"><input name="linkuid" placeholder="UID do usuário no Supabase Auth">' +
          '<button type="button" class="btn ghost sm" data-act="link">Vincular</button></div>' +
          '<div class="muted">Use se o login já foi criado no painel do Supabase (Authentication → Users → copiar o User UID).</div></div>');
        linkWrap.querySelector('[data-act="link"]').onclick = function () {
          const uid = String(linkWrap.querySelector('[name="linkuid"]').value || '').trim();
          if (!uid) { err.textContent = 'Cole o UID do login.'; return; }
          err.textContent = 'Vinculando…';
          Auth.adminApi('link', { usuarioId: u.id, authUid: uid }).then(function (r) {
            if (!r.ok) { err.textContent = r.msg; return; }
            C.toast('Login vinculado. O usuário já pode entrar.');
            Store.hydrate();
            m.close();
          });
        };
        b.appendChild(linkWrap);
      }
    }

    let busy = false;
    const m = C.modal(isNew ? 'Novo usuário' : 'Editar usuário', b, {
      saveLabel: isNew ? 'Criar usuário' : 'Salvar', onSave: function () {
        if (busy) return false;
        err.textContent = '';
        const nome = fval(b, 'nome');
        const nivel = fval(b, 'nivel'), status = fval(b, 'status');
        if (!nome) { err.textContent = 'Informe o nome.'; return false; }

        /* ----- edição de usuário existente (nome / nível / status / telefone / cargo) ----- */
        if (!isNew) {
          if (u.id === Auth.currentId() && (status !== 'ativo' || nivel !== 'admin')) {
            err.textContent = 'Você não pode remover o seu próprio acesso de administrador enquanto está logado.';
            return false;
          }
          Store.update('usuarios', u.id, {
            nome: nome, email: u.email,           // e-mail preservado (não editável nesta fase)
            telefone: fval(b, 'tel'), cargo: fval(b, 'cargo'), nivel: nivel, status: status
          });
          C.toast('Usuário salvo.');
          return; // fecha o modal
        }

        /* ----- criação: vai para a função serverless (cria login + registro) ----- */
        const email = fval(b, 'email').toLowerCase();
        const senha = fval(b, 'senha');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'E-mail inválido.'; return false; }
        if (senha.length < 6) { err.textContent = 'A senha precisa ter ao menos 6 caracteres.'; return false; }
        const dup = Store.all('usuarios').find(function (x) { return (x.email || '').toLowerCase() === email; });
        if (dup) { err.textContent = 'Já existe um usuário com este e-mail no CRM.'; return false; }

        busy = true;
        err.textContent = 'Criando usuário…';
        Auth.adminApi('create', {
          nome: nome, email: email, senha: senha, nivel: nivel, status: status,
          telefone: fval(b, 'tel'), cargo: fval(b, 'cargo')
        }).then(function (r) {
          busy = false;
          if (!r.ok) {
            err.textContent = r.msg + (r.inconsistent && r.authUid ? ' (uid: ' + r.authUid + ')' : '');
            return;
          }
          C.toast('Usuário criado. Ele já pode entrar no CRM.');
          Store.hydrate();
          m.close();
        });
        return false; // mantém o modal aberto até a API responder
      }
    });
  }

  function usersTab(pane) {
    const add = U.el('<button class="btn primary sm">+ Novo usuário</button>');
    add.onclick = function () { userForm(null); };
    pane.appendChild(add);

    const list = Store.all('usuarios').sort(function (a, b) { return (a.nome || '').localeCompare(b.nome || ''); });
    const wrap = U.el('<div class="card table-wrap"><table class="table"><thead><tr>' +
      '<th>Nome</th><th>E-mail</th><th>Telefone</th><th>Cargo</th><th>Nível</th><th>Status</th><th>Login</th><th>Cadastro</th><th>Último acesso</th><th></th></tr></thead><tbody></tbody></table></div>');
    const tb = wrap.querySelector('tbody');
    list.forEach(function (u) {
      const stCls = u.status === 'ativo' ? 'st-ok' : u.status === 'bloqueado' ? 'st-bad' : 'st-muted';
      const loginChip = u.authUid ? C.chip('ATIVO', 'st-ok') : C.chip('PENDENTE', 'st-muted');
      const tr = U.el('<tr><td>' + U.esc(u.nome) + '</td><td>' + U.esc(u.email) + '</td><td>' + U.esc(u.telefone || '—') + '</td>' +
        '<td>' + U.esc(u.cargo || '—') + '</td><td>' + U.esc(u.nivel) + '</td><td>' + C.chip(u.status, stCls) + '</td>' +
        '<td>' + loginChip + '</td>' +
        '<td>' + U.fmtDate(u.criadoEm) + '</td><td>' + (u.ultimoAcesso ? U.fmtDateTime(u.ultimoAcesso) : '—') + '</td>' +
        '<td class="row-actions"></td></tr>');
      const act = tr.querySelector('.row-actions');
      const edit = U.el('<button class="iconbtn" title="Editar">✏️</button>');
      edit.onclick = function () { userForm(u); };
      act.appendChild(edit);
      if (u.id !== Auth.currentId()) {
        const toggle = U.el('<button class="iconbtn" title="Alternar status">' + (u.status === 'ativo' ? '⏸️' : '▶️') + '</button>');
        toggle.onclick = function () { Store.update('usuarios', u.id, { status: u.status === 'ativo' ? 'inativo' : 'ativo' }); };
        const block = U.el('<button class="iconbtn" title="' + (u.status === 'bloqueado' ? 'Desbloquear' : 'Bloquear') + '">' + (u.status === 'bloqueado' ? '🔓' : '🔒') + '</button>');
        block.onclick = function () { Store.update('usuarios', u.id, { status: u.status === 'bloqueado' ? 'ativo' : 'bloqueado' }); };
        act.append(toggle, block);
        /* Exclusão de usuário foi removida (Fase 4): usar inativo/bloqueado.
           Nada é apagado do Supabase Auth nem os registros vinculados. */
      }
      tb.appendChild(tr);
    });
    pane.appendChild(wrap);
    pane.appendChild(U.el('<div class="muted">Ao desativar ou bloquear um usuário ele não entra mais no CRM, mas todo o histórico dele é preservado.</div>'));
    pane.appendChild(U.el('<div class="muted" style="margin-top:8px">' +
      '<b>Login (coluna acima):</b> “ativo” = o usuário já tem acesso ao Supabase e consegue entrar. ' +
      '“pendente” = o cadastro existe no CRM mas o login ainda não foi criado.<br>' +
      'A criação do login exige uma chave privilegiada do servidor e <b>não pode ser feita com segurança pelo navegador</b>. ' +
      'Ela será feita por uma função no servidor (etapa seguinte). Até lá, o login de cada usuário “pendente” é criado ' +
      'manualmente no painel do Supabase (Authentication → Add user) e vinculado ao cadastro.' +
      '</div>'));
  }

  /* ---------- listas simples (origens / administradoras) ---------- */
  function listaConfig(pane, chave, titulo) {
    const arr = (Store.config()[chave] || []).slice();
    const add = U.el('<div class="filters"><input id="nv" placeholder="Adicionar ' + titulo + '"><button class="btn primary sm" id="ad">Adicionar</button></div>');
    pane.appendChild(add);
    const wrap = U.el('<div class="card"><div class="tag-list"></div></div>');
    const tl = wrap.querySelector('.tag-list');
    arr.forEach(function (v) {
      const t = U.el('<span class="tagchip">' + U.esc(v) + ' <button title="Remover">✕</button></span>');
      t.querySelector('button').onclick = function () {
        Store.setConfig((function () { const o = {}; o[chave] = Store.config()[chave].filter(function (x) { return x !== v; }); return o; })());
      };
      tl.appendChild(t);
    });
    pane.appendChild(wrap);
    add.querySelector('#ad').onclick = function () {
      const v = add.querySelector('#nv').value.trim();
      if (!v) return;
      if (Store.config()[chave].indexOf(v) >= 0) { alert('Já existe.'); return; }
      const o = {}; o[chave] = Store.config()[chave].concat([v]);
      Store.setConfig(o);
    };
  }
  function origensTab(pane) { listaConfig(pane, 'origens', 'origem'); }
  function adminsTab(pane) { listaConfig(pane, 'administradoras', 'administradora'); }

  /* ---------- produtos ---------- */
  function produtosTab(pane) {
    const add = U.el('<button class="btn primary sm">+ Novo produto</button>');
    add.onclick = function () { prodForm(null); };
    pane.appendChild(add);
    const list = Store.all('produtos');
    const wrap = U.el('<div class="card table-wrap"><table class="table"><thead><tr><th>Nome</th><th>Ativo</th><th></th></tr></thead><tbody></tbody></table></div>');
    const tb = wrap.querySelector('tbody');
    list.forEach(function (p) {
      const tr = U.el('<tr><td>' + U.esc(p.nome) + '</td><td>' + (p.ativo ? 'Sim' : 'Não') + '</td><td class="row-actions"></td></tr>');
      const e = U.el('<button class="iconbtn">✏️</button>'); e.onclick = function () { prodForm(p); };
      const d = U.el('<button class="iconbtn">🗑️</button>'); d.onclick = function () { C.confirm('Excluir "' + p.nome + '"?', function () { Store.remove('produtos', p.id); }); };
      tr.querySelector('.row-actions').append(e, d);
      tb.appendChild(tr);
    });
    pane.appendChild(wrap);
  }
  function prodForm(p) {
    const isNew = !p; p = p || { nome: '', ativo: true };
    const b = buildForm(
      C.field('Nome do produto', '<input name="nome" value="' + U.esc(p.nome) + '">', true) +
      C.field('Ativo', '<select name="ativo"><option value="1"' + (p.ativo ? ' selected' : '') + '>Sim</option><option value="0"' + (!p.ativo ? ' selected' : '') + '>Não</option></select>')
    );
    C.modal(isNew ? 'Novo produto' : 'Editar produto', b, {
      saveLabel: 'Salvar', onSave: function () {
        const rec = { nome: fval(b, 'nome'), ativo: fval(b, 'ativo') === '1' };
        if (!rec.nome) { alert('Informe o nome.'); return false; }
        if (isNew) Store.insert('produtos', rec); else Store.update('produtos', p.id, rec);
      }
    });
  }

  /* ---------- Painel TV ---------- */
  function painelUrl(token) { return new URL('painel-tv.html?tv=' + encodeURIComponent(token), location.href).href; }
  function genToken(nome) {
    const slug = (nome || 'TV').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 14) || 'TV';
    return 'TV-' + slug + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }
  function metasEquipeOpts(sel) {
    return C.opts(Store.all('metas').filter(function (m) { return m.tipo === 'equipe'; })
      .map(function (m) { return { value: m.id, label: m.nome }; }), sel, { blank: 'Meta ativa da equipe (automática)' });
  }

  function painelTvTab(pane) {
    pane.appendChild(U.el('<div class="card"><h3 class="card-title">📺 Painel de Metas para TV</h3>' +
      '<div class="muted">Tela cheia com META / VENDIDO / % / FALTA e gráfico de evolução, para exibir numa televisão. ' +
      'Atualiza sozinho quando uma venda é registrada. Cada TV tem um <b>link exclusivo</b> que só mostra o painel da meta — ' +
      'sem acesso a clientes, vendas individuais ou área administrativa.</div></div>'));

    const add = U.el('<div class="filters"><input id="nv" placeholder="Nome da TV (ex.: Agência)">' +
      '<select id="mt">' + metasEquipeOpts('') + '</select>' +
      '<button class="btn primary sm" id="ad">+ Adicionar TV</button></div>');
    pane.appendChild(add);
    add.querySelector('#ad').onclick = function () {
      const nome = add.querySelector('#nv').value.trim();
      if (!nome) { alert('Dê um nome para a TV.'); return; }
      const lista = (Store.config().painelTokens || []).concat([{ token: genToken(nome), nome: nome, metaId: add.querySelector('#mt').value || null }]);
      Store.setConfig({ painelTokens: lista });
      C.toast('TV adicionada.');
    };

    const lista = Store.config().painelTokens || [];
    if (!lista.length) { pane.appendChild(U.el('<div class="card empty">Nenhuma TV cadastrada ainda.</div>')); return; }

    lista.forEach(function (t) {
      const url = painelUrl(t.token);
      const card = U.el('<div class="card"><div class="meta-row-head"><div>' +
        '<b>' + U.esc(t.nome) + '</b> ' + C.chip(t.token, 'st-muted') + '</div><div class="meta-row-actions"></div></div>' +
        '<div class="muted">Meta: ' + (t.metaId ? U.esc(C.nomeMeta(t.metaId)) : 'ativa da equipe (automática)') + '</div>' +
        '<div class="muted" style="word-break:break-all">Link local: ' + U.esc(url) + '</div>' +
        '<div class="muted" style="word-break:break-all">Link publicado (depois do deploy): https://SEU-DOMINIO/painel-tv.html?tv=' + U.esc(t.token) + '</div></div>');
      const acts = card.querySelector('.meta-row-actions');

      const open = U.el('<button class="iconbtn" title="Abrir painel">▶️</button>');
      open.onclick = function () { window.open(url, '_blank'); };
      const copy = U.el('<button class="iconbtn" title="Copiar link local">📋</button>');
      copy.onclick = function () {
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { C.toast('Link copiado.'); }, function () { prompt('Copie o link:', url); });
      };
      const edit = U.el('<button class="iconbtn" title="Vincular a outra meta">✏️</button>');
      edit.onclick = function () {
        const b = buildForm(C.field('Nome da TV', '<input name="nome" value="' + U.esc(t.nome) + '">', true) +
          C.field('Meta exibida', '<select name="mt">' + metasEquipeOpts(t.metaId || '') + '</select>', true));
        C.modal('Editar TV', b, {
          saveLabel: 'Salvar', onSave: function () {
            const nome = fval(b, 'nome'); if (!nome) { alert('Informe o nome.'); return false; }
            Store.setConfig({
              painelTokens: (Store.config().painelTokens || []).map(function (x) {
                return x.token === t.token ? { token: x.token, nome: nome, metaId: fval(b, 'mt') || null } : x;
              })
            });
          }
        });
      };
      const del = U.el('<button class="iconbtn" title="Remover TV">🗑️</button>');
      del.onclick = function () {
        C.confirm('Remover a TV "' + t.nome + '"? O link dela deixa de funcionar.', function () {
          Store.setConfig({ painelTokens: (Store.config().painelTokens || []).filter(function (x) { return x.token !== t.token; }) });
        });
      };
      acts.append(open, copy, edit, del);
      pane.appendChild(card);
    });
  }

  function funilTab(pane) {
    pane.appendChild(U.el('<div class="card"><h3 class="card-title">Etapas do funil</h3><ol class="rank-list">' +
      Store.etapas().map(function (e) { return '<li><span>' + e.label + '</span><b>' + e.key + '</b></li>'; }).join('') +
      '</ol><div class="muted">As etapas são fixas nesta versão para manter a integridade dos dados. Renomeação/personalização pode ser adicionada depois.</div></div>'));
  }

  /* ---------- Google Calendar (Fase 1: só o fluxo OAuth) ---------- */
  function gcalTab(pane) {
    const card = U.el('<div class="card"><h3 class="card-title">Google Calendar</h3>' +
      '<div class="muted">Conecte a sua conta Google para que as reuniões do CRM possam, futuramente, ' +
      'aparecer no seu Google Calendar. Nesta etapa só fazemos a conexão da conta — nada é agendado ainda.</div></div>');
    const btn = U.el('<button class="btn primary" style="margin-top:12px">Conectar minha conta Google</button>');
    const msg = U.el('<div class="muted" style="margin-top:8px"></div>');
    btn.onclick = async function () {
      btn.disabled = true; msg.textContent = 'Abrindo o Google…';
      const r = await Auth.googleCalendarConnect();
      if (r && !r.ok) { btn.disabled = false; msg.textContent = r.msg || 'Não foi possível iniciar a conexão.'; }
      /* em caso de sucesso o navegador já saiu para a tela de consentimento do Google */
    };
    card.appendChild(btn);
    card.appendChild(msg);
    pane.appendChild(card);
  }

  function dadosTab(pane) {
    const d = Store._data();
    pane.appendChild(U.el('<div class="card"><h3 class="card-title">Resumo dos dados</h3><div class="funnel-mini">' +
      ['usuarios', 'leads', 'indicadores', 'simulacoes', 'propostas', 'vendas', 'metas'].map(function (k) {
        return '<div class="fm-item"><div class="fm-n">' + (d[k] ? d[k].length : 0) + '</div><div class="fm-l">' + k + '</div></div>';
      }).join('') + '</div></div>'));

    /* ---------- backup / exportação ---------- */
    const BACKUP_KEY = 'crm_consorcio_v1'; // mesma chave usada em js/store.js (const KEY)
    const backupCard = U.el('<div class="card" style="margin-top:14px"><h3 class="card-title">Backup dos dados</h3>' +
      '<div class="muted">Backup exporta uma cópia dos dados atuais. Nenhum dado será apagado.</div></div>');
    const exportBtn = U.el('<button class="btn primary">Exportar backup</button>');
    exportBtn.onclick = function () {
      try {
        const raw = localStorage.getItem(BACKUP_KEY);
        if (!raw) { alert('Não há dados salvos neste navegador para exportar.'); return; }
        let dados;
        try { dados = JSON.parse(raw); } catch (e) { dados = raw; } // se corrompido, preserva o texto cru
        const now = new Date();
        const p = function (n) { return String(n).padStart(2, '0'); };
        const stamp = now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate()) + '-' + p(now.getHours()) + p(now.getMinutes());
        const pacote = {
          tipo: 'crm-backup',
          app: 'CRM Consórcio — LFT',
          chave: BACKUP_KEY,
          exportadoEm: now.toISOString(),
          dados: dados
        };
        U.downloadBlob('crm-backup-' + stamp + '.json', 'application/json', JSON.stringify(pacote, null, 2));
        C.toast('Backup gerado.');
      } catch (e) {
        console.error(e);
        alert('Não foi possível gerar o backup: ' + (e && e.message || e));
      }
    };
    /* ---------- importar backup ---------- */
    const importBtn = U.el('<button class="btn ghost">Importar backup</button>');
    const fileInput = U.el('<input type="file" accept="application/json,.json" style="display:none">');
    importBtn.onclick = function () { fileInput.value = ''; fileInput.click(); };

    fileInput.onchange = function () {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;

      const processar = function (texto) {
        let pacote;
        try { pacote = JSON.parse(texto); } catch (e) { alert('Arquivo de backup inválido.'); return; }

        const valido = pacote && typeof pacote === 'object' &&
          pacote.tipo === 'crm-backup' &&
          pacote.chave === BACKUP_KEY &&
          pacote.dados && typeof pacote.dados === 'object' && !Array.isArray(pacote.dados);
        if (!valido) { alert('Arquivo de backup inválido.'); return; }

        C.confirm('Este backup substituirá os dados atuais deste navegador. Deseja continuar?', function () {
          try {
            localStorage.setItem(BACKUP_KEY, JSON.stringify(pacote.dados));
          } catch (e) {
            alert('Não foi possível salvar o backup: ' + (e && e.message || e));
            return;
          }
          alert('Backup importado com sucesso. O CRM será recarregado.');
          location.reload();
        });
      };

      if (typeof file.text === 'function') {
        file.text().then(processar, function () { alert('Arquivo de backup inválido.'); });
      } else {
        const fr = new FileReader();
        fr.onload = function () { processar(String(fr.result)); };
        fr.onerror = function () { alert('Arquivo de backup inválido.'); };
        fr.readAsText(file);
      }
    };

    const backupBtns = U.el('<div class="filters" style="margin-top:12px"></div>');
    backupBtns.append(exportBtn, importBtn, fileInput);
    backupCard.appendChild(backupBtns);
    pane.appendChild(backupCard);

    const demo = U.el('<button class="btn ghost">Carregar dados de exemplo</button>');
    demo.onclick = function () { C.confirm('Adiciona leads, propostas e uma venda de exemplo para você testar. Continuar?', function () { Store.loadDemo(); C.toast('Dados de exemplo carregados.'); }); };
    const wipe = U.el('<button class="btn ghost danger">Limpar tudo</button>');
    wipe.onclick = function () {
      C.confirm('Isso apaga TODOS os dados (leads, vendas, metas, usuários) e recria só o administrador. Não dá para desfazer. Continuar?', function () {
        Store.resetAll(); Auth.logout(); location.hash = ''; location.reload();
      });
    };
    const box = U.el('<div class="filters" style="margin-top:14px"></div>');
    box.append(demo, wipe);
    pane.appendChild(box);
  }
})();
