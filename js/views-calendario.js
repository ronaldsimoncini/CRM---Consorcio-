/* Calendário — agenda pessoal do usuário logado.
   Mostra SOMENTE as reuniões do próprio usuário (reunioes.owner_uid === Auth.uid()),
   inclusive para o administrador. Reaproveita o formulário e as ações do módulo
   Reuniões (Views._reuniao). Reaproveita a conexão Google já existente
   (Auth.googleCalendarConnect + GET /api/google-calendar/status). */
(function () {
  /* Retorno do OAuth do Google (?gcal=connected|error) — movido de Configurações.
     Roda no carregamento da página; mostra um toast e limpa o parâmetro. */
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

  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const BORDER = '#dfe3e8';
  const EVBG = '#eef1f4';
  const ACCENT = '#1E2D47';

  /* minhas reuniões: owner_uid === auth.uid() — igual ao que o RLS fará */
  function minhasReunioes() {
    const uid = (Auth.uid && Auth.uid()) || null;
    if (!uid) return [];
    return Store.all('reunioes').filter(function (r) { return r.owner_uid && r.owner_uid === uid; });
  }

  /* ---------------- card de conexão Google ---------------- */
  async function googleStatus() {
    const c = (window.Auth && Auth.client) ? Auth.client() : null;
    if (!c) return { connected: false };
    let token = null;
    try {
      const s = await c.auth.getSession();
      token = s && s.data && s.data.session && s.data.session.access_token;
    } catch (e) { /* ignora */ }
    if (!token) return { connected: false };
    const base = (window.CRM_CONFIG && window.CRM_CONFIG.painelApiBase) || '';
    try {
      const res = await fetch(base + '/api/google-calendar/status', { headers: { Authorization: 'Bearer ' + token } });
      const body = await res.json().catch(function () { return { connected: false }; });
      return (body && typeof body === 'object') ? body : { connected: false };
    } catch (e) { return { connected: false }; }
  }

  function googleCard() {
    const card = U.el('<div class="card"><h3 class="card-title">Google Calendar</h3>' +
      '<div class="muted" id="gc-desc">Verificando a conexão…</div></div>');
    const desc = card.querySelector('#gc-desc');
    const btn = U.el('<button class="btn primary" style="margin-top:12px" disabled>Conectar minha conta Google</button>');
    const msg = U.el('<div class="muted" style="margin-top:8px"></div>');

    btn.onclick = async function () {
      btn.disabled = true; msg.textContent = 'Abrindo o Google…';
      const r = await Auth.googleCalendarConnect();
      if (r && !r.ok) { btn.disabled = false; msg.textContent = r.msg || 'Não foi possível iniciar a conexão.'; }
      /* no sucesso o navegador já saiu para a tela de consentimento do Google */
    };

    card.appendChild(btn);
    card.appendChild(msg);

    googleStatus().then(function (st) {
      btn.disabled = false;
      if (st && st.connected) {
        desc.innerHTML = '✅ <b>Google Calendar conectado</b>' +
          (st.google_email ? ' (' + U.esc(st.google_email) + ')' : '') +
          '<br>Sua agenda está sincronizada — novas reuniões que você criar entram automaticamente.';
        btn.textContent = 'Reconectar Google';
      } else {
        desc.innerHTML = '⚠️ <b>Google Calendar não conectado</b><br>Conecte sua conta para enviar reuniões automaticamente.';
        btn.textContent = 'Conectar minha conta Google';
      }
    });

    return card;
  }

  /* ---------------- detalhe de uma reunião (reaproveita Views._reuniao) ---------------- */
  function abrirReuniao(id) {
    const r = Store.get('reunioes', id);
    if (!r) return;
    const R = Views._reuniao || {};
    const linha = function (lbl, val) { return '<div style="margin:5px 0"><span class="muted">' + lbl + ':</span> ' + val + '</div>'; };

    const body = U.el('<div></div>');
    body.innerHTML =
      linha('Título', U.esc(r.titulo || '—')) +
      linha('Data', U.fmtDate(r.data) + ' · ' + U.esc((r.horaInicio || '') + (r.horaFim ? '–' + r.horaFim : ''))) +
      linha('Tipo', U.esc(R.tipoLabel ? R.tipoLabel(r.tipo) : (r.tipo || '—'))) +
      linha('Status', R.statusLabel ? C.chip(R.statusLabel(r.status), R.statusCls(r.status)) : U.esc(r.status || '—')) +
      (r.observacoes ? linha('Observações', U.esc(r.observacoes)) : '') +
      (r.googleCalendarEventId ? '<div class="muted" style="margin-top:8px">✅ Adicionada ao seu Google Calendar</div>' : '');

    const extra = [];
    if (Auth.canEdit && Auth.canEdit() && Views._reuniao) {
      const ed = U.el('<button class="btn ghost">Editar reunião</button>');
      ed.onclick = function () { m.close(); Views._reuniao.editar(r); };
      extra.push(ed);
      if (r.status === 'agendada') {
        const ok = U.el('<button class="btn ghost">Marcar realizada</button>');
        ok.onclick = function () { m.close(); Views._reuniao.marcarRealizada(r); };
        const cx = U.el('<button class="btn ghost danger">Cancelar</button>');
        cx.onclick = function () { m.close(); Views._reuniao.cancelar(r); };
        extra.push(ok, cx);
      }
    }
    /* C.modal insere cada extraButton antes do 1º filho do rodapé (inverte a ordem) */
    const m = C.modal('Reunião', body, { extraButtons: extra.slice().reverse() });
  }

  /* ---------------- VIEW ---------------- */
  Views.calendario = function (container) {
    const head = U.el('<div class="page-head"><div>' +
      '<h1 class="page-title">Meu Calendário</h1>' +
      '<div class="muted">Visualize suas reuniões e organize sua agenda.</div>' +
      '</div></div>');
    if (Auth.canEdit && Auth.canEdit()) {
      const add = U.el('<button class="btn primary">+ Nova reunião</button>');
      add.onclick = function () { if (Views._reuniao) Views._reuniao.novo(); };
      head.appendChild(add);
    }
    container.appendChild(head);
    container.appendChild(googleCard());

    const hoje = new Date();
    let ano = hoje.getFullYear(), mes = hoje.getMonth();

    const box = U.el('<div class="card" style="margin-top:14px"></div>');
    container.appendChild(box);

    function draw() {
      const porDia = {};
      minhasReunioes().forEach(function (r) {
        if (!r.data) return;
        (porDia[r.data] = porDia[r.data] || []).push(r);
      });
      Object.keys(porDia).forEach(function (k) {
        porDia[k].sort(function (a, b) { return (a.horaInicio || '') < (b.horaInicio || '') ? -1 : 1; });
      });

      const inicioSemana = new Date(ano, mes, 1).getDay();
      const diasNoMes = new Date(ano, mes + 1, 0).getDate();
      const linhas = Math.ceil((inicioSemana + diasNoMes) / 7) * 7;

      let html = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">' +
        '<button class="btn ghost sm" data-nav="-1">‹ Mês anterior</button>' +
        '<b style="text-transform:capitalize">' + MESES[mes] + ' de ' + ano + '</b>' +
        '<button class="btn ghost sm" data-nav="1">Próximo mês ›</button>' +
        '<button class="btn ghost sm" data-nav="0">Hoje</button></div>';

      html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">';
      DIAS.forEach(function (d) { html += '<div class="muted" style="text-align:center;font-size:12px;font-weight:600;padding:2px 0">' + d + '</div>'; });

      for (let i = 0; i < linhas; i++) {
        const dia = i - inicioSemana + 1;
        if (dia < 1 || dia > diasNoMes) { html += '<div style="min-height:88px"></div>'; continue; }
        const iso = ano + '-' + String(mes + 1).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
        const isHoje = iso === U.todayISO();
        const evs = porDia[iso] || [];
        html += '<div style="min-height:88px;border:1px solid ' + BORDER + ';border-radius:8px;padding:4px 5px;overflow:hidden' +
          (isHoje ? ';outline:2px solid ' + ACCENT + ';outline-offset:-1px' : '') + '">' +
          '<div class="muted" style="font-size:12px;font-weight:600">' + dia + '</div>';
        evs.slice(0, 4).forEach(function (r) {
          html += '<div class="cal-ev" data-id="' + U.esc(r.id) + '" ' +
            'style="font-size:11px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;' +
            'border-radius:4px;padding:1px 4px;margin-top:2px;background:' + EVBG +
            (r.status === 'cancelada' ? ';text-decoration:line-through;opacity:.55' : '') + '" ' +
            'title="' + U.esc((r.horaInicio || '') + ' ' + (r.titulo || '')) + '">' +
            U.esc(r.horaInicio || '') + ' ' + U.esc(r.titulo || '(sem título)') + '</div>';
        });
        if (evs.length > 4) html += '<div class="muted" style="font-size:10px;margin-top:2px">+' + (evs.length - 4) + ' mais</div>';
        html += '</div>';
      }
      html += '</div>';

      const mesLabel = { reuniao: 'Reunião', ligacao: 'Ligação', visita: 'Visita', retorno: 'Retorno', outro: 'Outro' };
      const doMes = [];
      Object.keys(porDia).sort().forEach(function (d) {
        if (d.slice(0, 7) !== ano + '-' + String(mes + 1).padStart(2, '0')) return;
        porDia[d].forEach(function (r) { doMes.push(r); });
      });
      if (doMes.length) {
        html += '<div style="margin-top:16px"><b>Reuniões do mês</b></div>' +
          '<div class="table-wrap" style="margin-top:6px"><table class="table"><thead><tr>' +
          '<th>Data</th><th>Horário</th><th>Título</th><th>Tipo</th><th>Status</th></tr></thead><tbody>' +
          doMes.map(function (r) {
            const R = Views._reuniao || {};
            return '<tr class="cal-row" data-id="' + U.esc(r.id) + '" style="cursor:pointer">' +
              '<td>' + U.fmtDate(r.data) + '</td>' +
              '<td>' + U.esc((r.horaInicio || '') + (r.horaFim ? '–' + r.horaFim : '')) + '</td>' +
              '<td>' + U.esc(r.titulo || '—') + '</td>' +
              '<td>' + U.esc(mesLabel[r.tipo] || r.tipo || '—') + '</td>' +
              '<td>' + (R.statusLabel ? C.chip(R.statusLabel(r.status), R.statusCls(r.status)) : U.esc(r.status || '—')) + '</td>' +
              '</tr>';
          }).join('') + '</tbody></table></div>';
      } else {
        html += '<div class="empty" style="margin-top:14px">Nenhuma reunião neste mês.</div>';
      }

      box.innerHTML = html;

      box.querySelectorAll('[data-nav]').forEach(function (b) {
        b.onclick = function () {
          const v = Number(b.dataset.nav);
          if (v === 0) { ano = hoje.getFullYear(); mes = hoje.getMonth(); }
          else {
            mes += v;
            if (mes < 0) { mes = 11; ano--; }
            else if (mes > 11) { mes = 0; ano++; }
          }
          draw();
        };
      });
      box.querySelectorAll('.cal-ev, .cal-row').forEach(function (el) {
        el.onclick = function () { abrirReuniao(el.dataset.id); };
      });
    }

    draw();
  };
})();
