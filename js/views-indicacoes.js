/* Vendas por Indicação — comissão de 1% para o funcionário LFT que indicou.
   Fonte: tabela public.comissoes_indicacao (lida direto do Supabase; RLS libera
   só admin ou quem tem a permissão 'vendas_indicacao'). Toda escrita é feita
   pelas RPCs SECURITY DEFINER — nunca INSERT/UPDATE/DELETE direto.
   Não usa o Store: é uma tela financeira de acesso restrito, online. */
(function () {
  const PERM = 'vendas_indicacao';
  const STATUS_LABEL = { pendente: 'Pendente', pago: 'Pago' };
  const STATUS_CLS = { pendente: 'st-warn', pago: 'st-ok' };
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function money(n) { return U.brl(Number(n) || 0); }
  function mesAtual() { return U.todayISO().slice(0, 7); }
  function mesLabel(m) {
    const p = String(m || '').split('-');
    if (p.length < 2) return m || '—';
    const nome = MESES[Number(p[1]) - 1];
    return (nome ? nome.charAt(0).toUpperCase() + nome.slice(1) : p[1]) + '/' + p[0];
  }
  function sb() { return (window.Auth && Auth.client) ? Auth.client() : null; }

  /* ---------------- acesso ao Supabase ---------------- */
  function fetchComissoes() {
    const c = sb();
    if (!c) return Promise.resolve({ error: 'sem conexão', rows: [] });
    return c.from('comissoes_indicacao').select('id, owner_uid, data, updated_at').then(function (res) {
      if (res.error) return { error: res.error.message || 'erro', rows: [] };
      const rows = (res.data || []).map(function (r) {
        return Object.assign({ id: r.id, owner_uid: r.owner_uid }, r.data || {});
      });
      return { rows: rows };
    }, function (e) { return { error: (e && e.message) || 'erro', rows: [] }; });
  }

  function rpc(fn, args) {
    const c = sb();
    if (!c) return Promise.resolve({ ok: false, error: 'sem conexão' });
    return c.rpc(fn, args || {}).then(function (res) {
      if (res.error) return { ok: false, error: res.error.message || 'erro' };
      return (res.data && typeof res.data === 'object') ? res.data : { ok: true };
    }, function (e) { return { ok: false, error: (e && e.message) || 'erro' }; });
  }

  /* ---------------- helper exposto p/ leads e vendas (Bloco 4) ----------------
     Dispara o cálculo/atualização da comissão de uma venda. Espera a venda já
     estar gravada no Supabase (Store.sync) e chama a RPC. NUNCA bloqueia nem
     desfaz a venda; a RPC valida tudo no servidor. */
  async function sync(venda) {
    if (!venda || !venda.id) return { ok: false, error: 'venda inválida' };
    try { if (Store && Store.sync) await Store.sync(); } catch (e) { /* ignora */ }
    const r = await rpc('sync_comissao_indicacao', { p_venda_id: venda.id });
    if (r && r.ok === false) console.error('sync_comissao_indicacao:', r.error);
    return r;
  }

  Views._indicacao = { sync: sync };

  /* ---------------- a aba ---------------- */
  Views.indicacoes = function (container) {
    const head = U.el('<div class="page-head"><div>' +
      '<h1 class="page-title">Vendas por Indicação</h1>' +
      '<div class="muted">Comissão de 1% sobre o valor do crédito, para o funcionário LFT que indicou o cliente.</div>' +
      '</div></div>');
    container.appendChild(head);

    if (!(window.Auth && Auth.can && Auth.can(PERM))) {
      container.appendChild(U.el('<div class="card empty">Acesso restrito. Fale com o administrador.</div>'));
      return;
    }

    let mes = mesAtual();
    let rows = [];

    const bar = U.el('<div class="filters"></div>');
    bar.appendChild(U.el('<span class="muted" style="align-self:center">Mês da venda</span>'));
    const mesInput = U.el('<input type="month" value="' + mes + '">');
    bar.appendChild(mesInput);
    const btnReload = U.el('<button class="btn ghost sm">Atualizar</button>');
    bar.appendChild(btnReload);
    container.appendChild(bar);

    const kpis = U.el('<div class="kpi-row wide"></div>');
    const porInd = U.el('<div class="card"></div>');
    const tableWrap = U.el('<div class="card table-wrap"></div>');
    container.appendChild(kpis);
    container.appendChild(porInd);
    container.appendChild(tableWrap);

    mesInput.onchange = function () { mes = mesInput.value || mesAtual(); draw(); };
    btnReload.onclick = function () { load(); };

    function doMes() {
      return rows.filter(function (r) { return String(r.dataVenda || '').slice(0, 7) === mes; })
        .sort(function (a, b) { return (b.dataVenda || '') < (a.dataVenda || '') ? -1 : 1; });
    }

    function draw() {
      const list = doMes();
      const somaCom = function (arr) { return arr.reduce(function (s, r) { return s + (Number(r.valorComissao) || 0); }, 0); };
      const totCred = list.reduce(function (s, r) { return s + (Number(r.valorCredito) || 0); }, 0);
      const totCom = somaCom(list);
      const totPend = somaCom(list.filter(function (r) { return r.status !== 'pago'; }));
      const totPago = somaCom(list.filter(function (r) { return r.status === 'pago'; }));

      kpis.innerHTML =
        C.kpi('Total vendido por indicação', money(totCred), mesLabel(mes)) +
        C.kpi('Total de comissão (1%)', money(totCom)) +
        C.kpi('Comissão pendente', money(totPend)) +
        C.kpi('Comissão paga', money(totPago));

      /* resumo por indicador */
      const agg = {};
      list.forEach(function (r) {
        const k = r.indicadorUsuarioId || '—';
        if (!agg[k]) agg[k] = { credito: 0, comissao: 0, qtd: 0 };
        agg[k].credito += Number(r.valorCredito) || 0;
        agg[k].comissao += Number(r.valorComissao) || 0;
        agg[k].qtd++;
      });
      const keys = Object.keys(agg).sort(function (a, b) { return agg[b].comissao - agg[a].comissao; });
      porInd.innerHTML = '<h3 class="card-title">Por indicador — ' + U.esc(mesLabel(mes)) + '</h3>' +
        (keys.length
          ? '<div class="table-wrap"><table class="table"><thead><tr><th>Indicador</th><th>Vendas</th>' +
            '<th class="num">Total indicado</th><th class="num">Comissão</th></tr></thead><tbody>' +
            keys.map(function (k) {
              return '<tr><td>' + U.esc(k === '—' ? '—' : C.nomeUsuario(k)) + '</td>' +
                '<td>' + agg[k].qtd + '</td>' +
                '<td class="num">' + money(agg[k].credito) + '</td>' +
                '<td class="num">' + money(agg[k].comissao) + '</td></tr>';
            }).join('') + '</tbody></table></div>'
          : '<div class="empty">Nenhuma comissão de indicação neste mês.</div>');

      /* tabela detalhada */
      tableWrap.innerHTML =
        '<table class="table"><thead><tr><th>Data da venda</th><th>Cliente</th><th>Vendedor</th><th>Indicador</th>' +
        '<th class="num">Valor do crédito</th><th class="num">%</th><th class="num">Comissão</th><th>Status</th><th></th></tr></thead><tbody>' +
        list.map(function (r) {
          const pct = (Number(r.percentual) || 0.01) * 100;
          return '<tr data-id="' + U.esc(r.id) + '">' +
            '<td>' + U.fmtDate(r.dataVenda) + '</td>' +
            '<td>' + U.esc(r.cliente || '—') + '</td>' +
            '<td>' + U.esc(r.consultorId ? C.nomeUsuario(r.consultorId) : '—') + '</td>' +
            '<td>' + U.esc(r.indicadorUsuarioId ? C.nomeUsuario(r.indicadorUsuarioId) : '—') + '</td>' +
            '<td class="num">' + money(r.valorCredito) + '</td>' +
            '<td class="num">' + (pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(2)) + '%</td>' +
            '<td class="num">' + money(r.valorComissao) + '</td>' +
            '<td>' + C.chip(STATUS_LABEL[r.status] || r.status || '—', STATUS_CLS[r.status] || 'st-muted') + '</td>' +
            '<td class="row-actions"></td></tr>';
        }).join('') +
        '</tbody></table>' + (list.length ? '' : '<div class="empty">Nenhuma comissão de indicação neste mês.</div>');

      tableWrap.querySelectorAll('tr[data-id]').forEach(function (tr) {
        const r = list.filter(function (x) { return x.id === tr.dataset.id; })[0];
        if (!r) return;
        const acts = tr.querySelector('.row-actions');
        if (r.status === 'pago') {
          acts.appendChild(mkBtn('Reabrir', function () {
            act('reabrir_comissao_indicacao', r, 'Reabrir o pagamento desta comissão? Ela volta para "Pendente".');
          }));
        } else {
          acts.appendChild(mkBtn('Marcar pago', function () {
            act('marcar_comissao_indicacao_paga', r, 'Marcar esta comissão como PAGA? A data do pagamento fica registrada.');
          }));
        }
        acts.appendChild(mkBtn('Recalcular', function () {
          act('recalcular_comissao_indicacao', r, 'Recalcular a comissão pelo valor de crédito ATUAL da venda? Use para corrigir conscientemente.');
        }));
        acts.appendChild(mkBtn('Remover', function () {
          act('remover_comissao_indicacao', r, 'Remover esta comissão? A venda e o histórico do lead NÃO são afetados.');
        }, 'danger'));
      });
    }

    function mkBtn(label, fn, cls) {
      const b = U.el('<button class="btn ghost sm' + (cls ? ' ' + cls : '') + '">' + label + '</button>');
      b.onclick = fn;
      return b;
    }

    function act(fn, r, msg) {
      C.confirm(msg, function () {
        rpc(fn, { p_id: r.id }).then(function (res) {
          if (res && res.ok === false) { C.toast('Não foi possível concluir: ' + (res.error || 'erro')); return; }
          C.toast('Feito.');
          load();
        });
      });
    }

    function load() {
      kpis.innerHTML = '';
      porInd.innerHTML = '<div class="muted">Carregando…</div>';
      tableWrap.innerHTML = '';
      fetchComissoes().then(function (res) {
        if (res.error) {
          porInd.innerHTML = '';
          tableWrap.innerHTML = '<div class="card empty">Não foi possível carregar as comissões (' + U.esc(res.error) + ').</div>';
          return;
        }
        rows = res.rows;
        draw();
      });
    }

    load();
  };
})();
