/* Reuniões — compromissos do usuário logado.
   Base para a futura integração com o Google Calendar (owner_uid → conta
   Google do mesmo auth_uid). Nesta fase é só a entidade dentro do CRM. */
(function () {
  const TIPOS = [
    { value: 'reuniao', label: 'Reunião' },
    { value: 'ligacao', label: 'Ligação' },
    { value: 'visita', label: 'Visita' },
    { value: 'retorno', label: 'Retorno' },
    { value: 'outro', label: 'Outro' }
  ];
  const TIPO_LABEL = TIPOS.reduce(function (m, t) { m[t.value] = t.label; return m; }, {});
  const STATUS_LABEL = { agendada: 'Agendada', realizada: 'Realizada', cancelada: 'Cancelada' };
  const STATUS_CLS = { agendada: 'st-info', realizada: 'st-ok', cancelada: 'st-muted' };
  const FILTROS = ['todas', 'hoje', 'proximas', 'realizadas', 'canceladas'];
  const FILTRO_LABEL = { todas: 'Todas', hoje: 'Hoje', proximas: 'Próximas', realizadas: 'Realizadas', canceladas: 'Canceladas' };

  function fval(b, n) { const e = b.querySelector('[name="' + n + '"]'); return e ? String(e.value).trim() : ''; }
  function scopedReunioes() { return Auth.scope(Store.all('reunioes')); }
  function scopedLeads() { return Auth.scope(Store.all('leads')); }

  /* Responsável = owner_uid (auth_uid). Sem segunda identificação no JSONB. */
  function nomeResponsavel(ownerUid) {
    if (!ownerUid) return '—';
    if (ownerUid === Auth.uid()) return 'Você';
    const u = Store.all('usuarios').find(function (x) { return x.authUid === ownerUid; });
    return u ? u.nome : '—';
  }

  function ordena(list) {
    return list.slice().sort(function (a, b) {
      const ka = (a.data || '') + ' ' + (a.horaInicio || '');
      const kb = (b.data || '') + ' ' + (b.horaInicio || '');
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }

  /* ---------------- Google Calendar (Fase 2) ----------------
     Cria o evento no Google Calendar do PRÓPRIO usuário. O JWT é enviado no
     header; o servidor identifica o auth_uid pelo token e usa só a conexão
     Google desse usuário. NUNCA impede/atrapalha a reunião do CRM. */
  async function apiGooglePost(path, payload) {
    const c = (window.Auth && Auth.client) ? Auth.client() : null;
    if (!c) return { ok: false, code: 'NO_CLIENT' };
    let token = null;
    try {
      const s = await c.auth.getSession();
      token = s && s.data && s.data.session && s.data.session.access_token;
    } catch (e) { /* ignora */ }
    if (!token) return { ok: false, code: 'NO_SESSION' };
    const base = (window.CRM_CONFIG && window.CRM_CONFIG.painelApiBase) || '';
    try {
      const res = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(payload || {})
      });
      const body = await res.json().catch(function () { return {}; });
      return (body && typeof body === 'object') ? body : { ok: false, code: 'BAD_RESPONSE' };
    } catch (e) { return { ok: false, code: 'NETWORK' }; }
  }

  async function agendarNoGoogle(reuniao) {
    try { if (Store.sync) await Store.sync(); } catch (e) { /* ignora */ }

    const lead = reuniao.leadId ? Store.get('leads', reuniao.leadId) : null;
    const r = await apiGooglePost('/api/google-calendar/create-event', {
      reuniaoId: reuniao.id,
      titulo: reuniao.titulo,
      data: reuniao.data,
      horaInicio: reuniao.horaInicio,
      horaFim: reuniao.horaFim,
      observacoes: reuniao.observacoes || '',
      leadNome: lead ? (lead.nome || '') : '',
      leadTelefone: lead ? (lead.telefone || lead.whatsapp || '') : ''
    });

    if (r && r.ok && r.eventId) {
      Store.update('reunioes', reuniao.id, { googleCalendarEventId: r.eventId, googleCalendarStatus: 'created' });
      C.toast('Reunião adicionada ao seu Google Calendar.');
      return;
    }
    const code = r && r.code;
    if (code === 'ALREADY_CREATED') return;
    if (code === 'GOOGLE_NOT_CONNECTED') { C.toast('Reunião salva. Seu Google Calendar ainda não está conectado.'); return; }
    if (code === 'GOOGLE_REVOKED') { C.toast('Reunião salva. Sua conexão com o Google Calendar precisa ser refeita.'); return; }
    C.toast('Reunião salva no CRM, mas não foi possível adicionar ao Google Calendar.');
  }

  /* Fase 3a: reunião com evento -> atualiza o evento no Google. Nunca cria.
     Falha do Google NÃO desfaz a edição no CRM. */
  async function atualizarNoGoogle(reuniaoId, campos, leadId) {
    try { if (Store.sync) await Store.sync(); } catch (e) { /* ignora */ }
    const lead = leadId ? Store.get('leads', leadId) : null;
    const r = await apiGooglePost('/api/google-calendar/update-event', {
      reuniaoId: reuniaoId,
      titulo: campos.titulo,
      data: campos.data,
      horaInicio: campos.horaInicio,
      horaFim: campos.horaFim,
      observacoes: campos.observacoes || '',
      leadNome: lead ? (lead.nome || '') : '',
      leadTelefone: lead ? (lead.telefone || lead.whatsapp || '') : ''
    });
    if (r && r.ok && r.code === 'UPDATED') { C.toast('Reunião atualizada no Google Calendar.'); return; }
    if (r && r.code === 'NO_EVENT') return; // não tinha evento — silêncio
    if (r && r.code === 'EVENT_MISSING') {
      C.toast('Reunião atualizada no CRM. O evento não existe mais no seu Google Calendar.');
      return;
    }
    C.toast('Reunião atualizada no CRM, mas não foi possível atualizar o Google Calendar.');
  }

  /* Fase 3a: reunião com evento -> remove o evento do Google. Nunca cria.
     Falha do Google NÃO desfaz o cancelamento no CRM. */
  async function removerDoGoogle(reuniaoId) {
    try { if (Store.sync) await Store.sync(); } catch (e) { /* ignora */ }
    const r = await apiGooglePost('/api/google-calendar/cancel-event', { reuniaoId: reuniaoId });
    if (r && r.ok) {
      if (r.code === 'NO_EVENT') return; // nada a remover
      C.toast('Reunião cancelada e removida do Google Calendar.');
      return;
    }
    C.toast('Reunião cancelada no CRM, mas não foi possível remover do Google Calendar.');
  }

  /* ---------------- integração com o Funil ----------------
     O Funil (js/views-leads.js) agenda reuniões para um lead. Para NÃO duplicar
     regras, ele chama agendarParaLead(), que usa exatamente a mesma lógica do
     "Nova reunião" deste módulo: cria UM registro em 'reunioes', define
     owner_uid e sincroniza com o Google Calendar. Reagendar o mesmo lead
     ATUALIZA o registro existente (e o evento no Google) — nunca cria outro. */
  function somaUmaHora(hhmm) {
    const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
    if (!m) return hhmm || '';
    const h = (Number(m[1]) + 1) % 24;
    return String(h).padStart(2, '0') + ':' + m[2];
  }

  /* reunião ativa (agendada) já ligada a este lead — por id explícito
     (lead.reuniao.reuniaoId) ou, para registros antigos, por leadId. */
  function reuniaoAtivaDoLead(lead) {
    if (!lead) return null;
    const rid = lead.reuniao && lead.reuniao.reuniaoId;
    if (rid) {
      const r = Store.get('reunioes', rid);
      if (r && r.status === 'agendada') return r;
    }
    return Store.all('reunioes').find(function (r) {
      return r.leadId === lead.id && r.status === 'agendada';
    }) || null;
  }

  function agendarParaLead(lead, dados) {
    if (!lead) return null;
    dados = dados || {};
    const dataISO = dados.data || U.todayISO();
    const ini = dados.hora || dados.horaInicio || '09:00';
    const fim = dados.horaFim || somaUmaHora(ini);
    const campos = {
      leadId: lead.id,
      titulo: dados.titulo || ('Reunião: ' + (lead.nome || '')),
      data: dataISO, horaInicio: ini, horaFim: fim,
      tipo: 'reuniao',
      observacoes: dados.obs || dados.observacoes || '',
      atualizadoEm: U.nowISO()
    };

    const existente = reuniaoAtivaDoLead(lead);
    if (existente) {
      Store.update('reunioes', existente.id, campos);
      if (existente.googleCalendarEventId) {
        atualizarNoGoogle(existente.id, campos, lead.id);
      } else {
        agendarNoGoogle(Store.get('reunioes', existente.id));
      }
      return Store.get('reunioes', existente.id);
    }

    const ownerUid =
      (Store.ownerUidFor && dados.consultorId && Store.ownerUidFor(dados.consultorId)) ||
      (Auth.uid && Auth.uid());
    const nova = Store.insert('reunioes', Object.assign(
      { owner_uid: ownerUid, status: 'agendada' }, campos
    ));
    agendarNoGoogle(nova);
    return nova;
  }

  /* ---------------- formulário ---------------- */
  function reuniaoForm(r) {
    const isNew = !r;
    r = r || { leadId: '', titulo: '', data: U.todayISO(), horaInicio: '09:00', horaFim: '10:00', tipo: 'reuniao', observacoes: '' };
    const leadItems = scopedLeads().map(function (l) { return { value: l.id, label: l.nome }; });

    const b = U.el('<div class="form-grid">' +
      C.field('Lead (opcional)', '<select name="lead">' + C.opts(leadItems, r.leadId || '', { blank: '— sem lead —' }) + '</select>', true) +
      C.field('Título', '<input name="titulo" value="' + U.esc(r.titulo || '') + '">', true) +
      C.field('Data', '<input type="date" name="data" value="' + U.esc(r.data || '') + '">') +
      C.field('Hora inicial', '<input type="time" name="ini" value="' + U.esc(r.horaInicio || '') + '">') +
      C.field('Hora final', '<input type="time" name="fim" value="' + U.esc(r.horaFim || '') + '">') +
      C.field('Tipo', '<select name="tipo">' + C.opts(TIPOS, r.tipo || 'reuniao') + '</select>') +
      C.field('Observações', '<textarea name="obs">' + U.esc(r.observacoes || '') + '</textarea>', true) +
      '</div>');
    const err = U.el('<div class="login-err" style="margin:6px 0"></div>');
    b.appendChild(err);
    if (!isNew && r.googleCalendarEventId) {
      b.appendChild(U.el('<div class="field full"><span></span><div class="muted">' +
        'Esta reunião está no seu Google Calendar. Ao salvar, o evento é atualizado.</div></div>'));
    }

    C.modal(isNew ? 'Nova reunião' : 'Editar reunião', b, {
      saveLabel: isNew ? 'Criar reunião' : 'Salvar', onSave: function () {
        err.textContent = '';
        const titulo = fval(b, 'titulo');
        const dataISO = fval(b, 'data');
        const ini = fval(b, 'ini'), fim = fval(b, 'fim');
        const leadId = fval(b, 'lead') || null;

        if (!titulo) { err.textContent = 'Informe o título.'; return false; }
        if (!dataISO || isNaN(new Date(dataISO + 'T00:00:00').getTime())) { err.textContent = 'Informe uma data válida.'; return false; }
        if (!ini) { err.textContent = 'Informe a hora inicial.'; return false; }
        if (!fim) { err.textContent = 'Informe a hora final.'; return false; }
        if (fim <= ini) { err.textContent = 'Horário de término deve ser maior que o horário de início.'; return false; }
        if (leadId && !Store.get('leads', leadId)) { err.textContent = 'Selecione um lead válido.'; return false; }

        const campos = {
          leadId: leadId, titulo: titulo, data: dataISO, horaInicio: ini, horaFim: fim,
          tipo: fval(b, 'tipo') || 'reuniao', observacoes: fval(b, 'obs'), atualizadoEm: U.nowISO()
        };

        if (isNew) {
          /* responsável = usuário logado (owner_uid = auth.uid()). O trigger do
             banco também garante isso; enviamos explícito para o cache ficar certo na hora. */
          const nova = Store.insert('reunioes', Object.assign({ owner_uid: Auth.uid(), status: 'agendada' }, campos));
          if (leadId) Store.logHist(leadId, 'reuniao',
            'Reunião agendada: ' + titulo + ' — ' + U.fmtDate(dataISO) + ' ' + ini, Auth.currentId());
          C.toast('Reunião criada.');
          /* depois de salvar: tenta criar o evento no Google (não bloqueia,
             não pode desfazer nem impedir a reunião do CRM) */
          agendarNoGoogle(nova);
        } else {
          const leadAntes = r.leadId || null;
          Store.update('reunioes', r.id, campos);
          if (leadId && leadId !== leadAntes) Store.logHist(leadId, 'reuniao',
            'Reunião vinculada: ' + titulo + ' — ' + U.fmtDate(dataISO) + ' ' + ini, Auth.currentId());
          C.toast('Reunião salva.');
          /* se a reunião tem evento Google, atualiza o evento (não bloqueia a edição) */
          if (r.googleCalendarEventId) atualizarNoGoogle(r.id, campos, leadId);
        }
      }
    });
  }

  /* ---------------- EXCLUIR (definitivo) ----------------
     Diferente de CANCELAR: remove o registro de public.reunioes.
     Ordem: 1) remove o evento do Google (API existente, ownership no servidor);
     2) só então apaga a reunião do CRM. Se o Google falhar, NADA é apagado. */
  function excluirReuniao(r) {
    if (!r) return;
    if (Auth.owns && !Auth.owns(r)) { C.toast('Você não pode excluir uma reunião de outro usuário.'); return; }
    C.confirm('Tem certeza que deseja excluir esta reunião?', function () {
      if (r.googleCalendarEventId) removerEventoEExcluir(r);
      else concluirExclusao(r);
    });
  }

  async function removerEventoEExcluir(r) {
    try { if (Store.sync) await Store.sync(); } catch (e) { /* ignora */ }
    const resp = await apiGooglePost('/api/google-calendar/cancel-event', { reuniaoId: r.id });
    if (resp && resp.ok) { concluirExclusao(r); return; }
    C.toast('Não foi possível remover o evento do Google Calendar. A reunião NÃO foi excluída.');
  }

  function concluirExclusao(r) {
    const lead = r.leadId ? Store.get('leads', r.leadId) : null;
    Store.batch(function () {
      if (r.leadId) Store.logHist(r.leadId, 'reuniao_excluida',
        'Reunião excluída: ' + (r.titulo || '') + (r.data ? ' — ' + U.fmtDate(r.data) : ''), Auth.currentId());
      Store.remove('reunioes', r.id);
      if (lead && lead.reuniao && lead.reuniao.reuniaoId === r.id) {
        Store.update('leads', lead.id, { reuniao: null });
      }
    });
    C.toast('Reunião excluída.');
  }

  function marcarRealizada(r) {
    C.confirm('Marcar a reunião "' + r.titulo + '" como realizada?', function () {
      Store.update('reunioes', r.id, { status: 'realizada', atualizadoEm: U.nowISO() });
      if (r.leadId) Store.logHist(r.leadId, 'reuniao_realizada', 'Reunião realizada: ' + r.titulo, Auth.currentId());
      C.toast('Reunião marcada como realizada.');
    });
  }
  function cancelarReuniao(r) {
    C.confirm('Cancelar a reunião "' + r.titulo + '"? Ela continua na lista, como cancelada.', function () {
      Store.update('reunioes', r.id, { status: 'cancelada', atualizadoEm: U.nowISO() });
      if (r.leadId) Store.logHist(r.leadId, 'reuniao_cancelada', 'Reunião cancelada: ' + r.titulo, Auth.currentId());
      C.toast('Reunião cancelada.');
      /* se a reunião tem evento Google, remove o evento (não bloqueia o cancelamento) */
      if (r.googleCalendarEventId) removerDoGoogle(r.id);
    });
  }

  /* ---------------- VIEW ---------------- */
  Views.reunioes = function (container) {
    const head = U.el('<div class="page-head"><h1 class="page-title">Reuniões</h1></div>');
    if (Auth.canEdit()) {
      const add = U.el('<button class="btn primary">+ Nova reunião</button>');
      add.onclick = function () { reuniaoForm(null); };
      head.appendChild(add);
    }
    container.appendChild(head);

    let filtro = 'todas';
    const bar = U.el('<div class="tabbar"></div>');
    container.appendChild(bar);
    const tableWrap = U.el('<div class="card table-wrap"></div>');
    container.appendChild(tableWrap);

    function draw() {
      bar.innerHTML = '';
      FILTROS.forEach(function (f) {
        const btn = U.el('<button class="tabbtn' + (f === filtro ? ' active' : '') + '">' + FILTRO_LABEL[f] + '</button>');
        btn.onclick = function () { filtro = f; draw(); };
        bar.appendChild(btn);
      });

      const hoje = U.todayISO();
      const rows = ordena(scopedReunioes().filter(function (r) {
        if (filtro === 'hoje') return r.data === hoje;
        if (filtro === 'proximas') return (r.data || '') >= hoje && r.status === 'agendada';
        if (filtro === 'realizadas') return r.status === 'realizada';
        if (filtro === 'canceladas') return r.status === 'cancelada';
        return true;
      }));

      tableWrap.innerHTML =
        '<table class="table"><thead><tr><th>Data</th><th>Horário</th><th>Título</th><th>Lead</th>' +
        '<th>Tipo</th><th>Responsável</th><th>Status</th><th></th></tr></thead><tbody>' +
        rows.map(function (r) {
          const lead = r.leadId ? Store.get('leads', r.leadId) : null;
          const leadCell = lead ? '<a href="#" data-lead="' + U.esc(r.leadId) + '">' + U.esc(lead.nome) + '</a>' : '—';
          return '<tr data-id="' + U.esc(r.id) + '">' +
            '<td>' + U.fmtDate(r.data) + '</td>' +
            '<td>' + U.esc((r.horaInicio || '') + (r.horaFim ? '–' + r.horaFim : '')) + '</td>' +
            '<td>' + U.esc(r.titulo || '—') + '</td>' +
            '<td>' + leadCell + '</td>' +
            '<td>' + U.esc(TIPO_LABEL[r.tipo] || r.tipo || '—') + '</td>' +
            '<td>' + U.esc(nomeResponsavel(r.owner_uid)) + '</td>' +
            '<td>' + C.chip(STATUS_LABEL[r.status] || r.status || '—', STATUS_CLS[r.status] || 'st-muted') + '</td>' +
            '<td class="row-actions"></td></tr>';
        }).join('') +
        '</tbody></table>' + (rows.length ? '' : '<div class="empty">Nenhuma reunião.</div>');

      tableWrap.querySelectorAll('a[data-lead]').forEach(function (a) {
        a.onclick = function (e) { e.preventDefault(); if (Views._lead) Views._lead.openModal(a.dataset.lead); };
      });
      tableWrap.querySelectorAll('tr[data-id]').forEach(function (tr) {
        if (!Auth.canEdit()) return;
        const r = Store.get('reunioes', tr.dataset.id);
        if (!r) return;
        const acts = tr.querySelector('.row-actions');
        const edit = U.el('<button class="iconbtn" title="Editar">✏️</button>');
        edit.onclick = function () { reuniaoForm(r); };
        acts.appendChild(edit);
        if (r.status === 'agendada') {
          const ok = U.el('<button class="iconbtn" title="Marcar como realizada">✅</button>');
          ok.onclick = function () { marcarRealizada(r); };
          const canc = U.el('<button class="iconbtn" title="Cancelar">🚫</button>');
          canc.onclick = function () { cancelarReuniao(r); };
          acts.append(ok, canc);
        }
        if (!Auth.owns || Auth.owns(r)) {
          const del = U.el('<button class="iconbtn" title="Excluir">🗑️</button>');
          del.onclick = function () { excluirReuniao(r); };
          acts.appendChild(del);
        }
      });
    }
    draw();
  };

  /* Exposto para a tela Calendário (js/views-calendario.js) reaproveitar o
     MESMO formulário e as MESMAS ações — sem duplicar regras. */
  Views._reuniao = {
    novo: function () { reuniaoForm(null); },
    editar: function (r) { reuniaoForm(r); },
    agendarParaLead: agendarParaLead,
    marcarRealizada: marcarRealizada,
    cancelar: cancelarReuniao,
    excluir: excluirReuniao,
    tipoLabel: function (t) { return TIPO_LABEL[t] || t || '—'; },
    statusLabel: function (s) { return STATUS_LABEL[s] || s || '—'; },
    statusCls: function (s) { return STATUS_CLS[s] || 'st-muted'; }
  };
})();
