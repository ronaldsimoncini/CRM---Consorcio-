/* Relatórios — Vendas e Indicações, com exportação PDF/Excel */
(function () {
  function money(n) { return U.brl(n); }

  Views.relatorios = function (container) {
    container.appendChild(U.el('<div class="page-head"><h1 class="page-title">Relatórios</h1></div>'));
    const host = U.el('<div></div>');
    container.appendChild(host);
    C.tabs(host, [
      { key: 'vendas', label: '📊 Relatório de Vendas' },
      { key: 'indic', label: '🤝 Relatório de Indicações' }
    ], function (key) {
      let pane = host.querySelector('.tabpane');
      if (!pane) { pane = U.el('<div class="tabpane"></div>'); host.appendChild(pane); }
      pane.innerHTML = '';
      if (key === 'vendas') relVendas(pane);
      else relIndicacoes(pane);
    }, 'rel');
  };

  /* ================= RELATÓRIO DE VENDAS ================= */
  function relVendas(pane) {
    const state = { periodo: '30d', ini: '', fim: '', consultor: '', adm: '', origem: '', ind: '', min: '', max: '' };

    const bar = U.el('<div class="filters">' +
      '<select id="p"><option value="hoje">Hoje</option><option value="7d">Últimos 7 dias</option>' +
      '<option value="30d" selected>Últimos 30 dias</option><option value="mes">Este mês</option>' +
      '<option value="mes_anterior">Mês anterior</option><option value="custom">Personalizado</option><option value="tudo">Tudo</option></select>' +
      '<input id="di" type="date" style="display:none"><input id="df" type="date" style="display:none">' +
      '<select id="c"><option value="">Consultor: todos</option>' + C.opts(C.usuariosConsultores(), '') + '</select>' +
      '<select id="a"><option value="">Administradora: todas</option>' + C.opts(Store.config().administradoras, '') + '</select>' +
      '<select id="o"><option value="">Origem: todas</option>' + C.opts(Store.config().origens, '') + '</select>' +
      '<select id="i"><option value="">Indicado por: todos</option>' + C.opts(Store.all('indicadores').map(function (x) { return { value: x.id, label: x.nome }; }), '') + '</select>' +
      '<input id="mn" inputmode="decimal" placeholder="Valor mín."><input id="mx" inputmode="decimal" placeholder="Valor máx.">' +
      '</div>');
    pane.appendChild(bar);

    const actions = U.el('<div class="filters"><button class="btn ghost" id="pdf">Exportar PDF</button><button class="btn ghost" id="xls">Exportar Excel</button></div>');
    pane.appendChild(actions);

    const out = U.el('<div></div>');
    pane.appendChild(out);

    function compute() {
      const r = state.periodo === 'tudo' ? U.range('tudo')
        : state.periodo === 'custom' ? U.range('custom', { ini: state.ini, fim: state.fim })
          : U.range(state.periodo);
      const mn = U.parseNumber(state.min), mx = U.parseNumber(state.max);
      const rows = Auth.scope(Store.all('vendas')).filter(function (v) {
        if (v.status !== 'venda_realizada') return false;
        if (!U.inRange(v.dataVenda, r)) return false;
        if (state.consultor && v.consultorId !== state.consultor) return false;
        if (state.adm && v.administradora !== state.adm) return false;
        if (state.origem && v.origem !== state.origem) return false;
        if (state.ind && v.indicadorId !== state.ind) return false;
        if (mn && (v.valorCredito || 0) < mn) return false;
        if (mx && (v.valorCredito || 0) > mx) return false;
        return true;
      }).sort(function (a, b) { return (a.dataVenda || '') < (b.dataVenda || '') ? -1 : 1; });
      return { r: r, rows: rows };
    }

    function stats(rows) {
      const vals = rows.map(function (v) { return Number(v.valorCredito) || 0; });
      const total = vals.reduce(function (s, x) { return s + x; }, 0);
      return {
        qtd: rows.length, total: total,
        media: rows.length ? total / rows.length : 0,
        maior: rows.length ? Math.max.apply(null, vals) : 0,
        menor: rows.length ? Math.min.apply(null, vals) : 0
      };
    }
    function porConsultor(rows) {
      const m = {};
      rows.forEach(function (v) { const k = v.consultorId || '—'; if (!m[k]) m[k] = { nome: C.nomeUsuario(v.consultorId), qtd: 0, valor: 0 }; m[k].qtd++; m[k].valor += Number(v.valorCredito) || 0; });
      return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.valor - a.valor; });
    }
    function porOrigem(rows) {
      const m = {};
      rows.forEach(function (v) { const k = v.origem || 'Outros'; if (!m[k]) m[k] = { nome: k, qtd: 0, valor: 0 }; m[k].qtd++; m[k].valor += Number(v.valorCredito) || 0; });
      return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.valor - a.valor; });
    }
    function bucket(rows) {
      const m = {};
      rows.forEach(function (v) { const k = (v.dataVenda || '').slice(0, 7); if (!m[k]) m[k] = { label: k, valor: 0, qtd: 0 }; m[k].valor += Number(v.valorCredito) || 0; m[k].qtd++; });
      return Object.keys(m).sort().map(function (k) { return m[k]; });
    }

    function draw() {
      const cx = compute();
      const s = stats(cx.rows);
      const pc = porConsultor(cx.rows), po = porOrigem(cx.rows);

      out.innerHTML =
        '<div class="sub muted">Período: ' + U.fmtDate(cx.r.ini) + ' a ' + U.fmtDate(cx.r.fim) + '</div>' +
        '<div class="kpi-row wide">' +
        C.kpi('Total de vendas', String(s.qtd)) +
        C.kpi('Valor total vendido', U.brlShort(s.total)) +
        C.kpi('Valor médio por venda', U.brlShort(s.media)) +
        C.kpi('Maior venda', U.brlShort(s.maior)) +
        C.kpi('Menor venda', U.brlShort(s.menor)) +
        '</div>' +
        '<div class="card"><h3 class="card-title">Evolução (por mês)</h3>' + C.barChart(bucket(cx.rows)) + '</div>' +
        '<div class="grid-2">' +
        '<div class="card"><h3 class="card-title">Resumo por consultor</h3><div class="table-wrap"><table class="table"><thead><tr><th>Consultor</th><th class="num">Vendas</th><th class="num">Valor</th></tr></thead><tbody>' +
        pc.map(function (x) { return '<tr><td>' + U.esc(x.nome) + '</td><td class="num">' + x.qtd + '</td><td class="num">' + U.brl(x.valor) + '</td></tr>'; }).join('') +
        '</tbody></table></div></div>' +
        '<div class="card"><h3 class="card-title">Resumo por origem</h3><div class="table-wrap"><table class="table"><thead><tr><th>Origem</th><th class="num">Vendas</th><th class="num">Valor</th></tr></thead><tbody>' +
        po.map(function (x) { return '<tr><td>' + U.esc(x.nome) + '</td><td class="num">' + x.qtd + '</td><td class="num">' + U.brl(x.valor) + '</td></tr>'; }).join('') +
        '</tbody></table></div></div></div>' +
        '<div class="card table-wrap"><table class="table"><thead><tr><th>Data</th><th>Cliente</th><th>Telefone</th><th>Consultor</th><th>Administradora</th>' +
        '<th class="num">Crédito</th><th class="num">Parcela</th><th>Origem</th><th>Indicado por</th><th>Status</th></tr></thead><tbody>' +
        cx.rows.map(function (v) {
          return '<tr><td>' + U.fmtDate(v.dataVenda) + '</td><td>' + U.esc(v.cliente) + '</td><td>' + U.esc(U.fmtPhone(v.telefone)) + '</td>' +
            '<td>' + U.esc(C.nomeUsuario(v.consultorId)) + '</td><td>' + U.esc(v.administradora || '—') + '</td>' +
            '<td class="num">' + U.brl(v.valorCredito) + '</td><td class="num">' + U.brl(v.valorParcela) + '</td>' +
            '<td>' + U.esc(v.origem || '—') + '</td><td>' + (v.indicadorId ? U.esc(C.nomeIndicador(v.indicadorId)) : '—') + '</td>' +
            '<td>Venda Realizada</td></tr>';
        }).join('') + '</tbody></table>' + (cx.rows.length ? '' : '<div class="empty">Nenhuma venda no filtro.</div>') + '</div>';
    }

    function exportPDF() {
      const cx = compute(); const s = stats(cx.rows);
      const pc = porConsultor(cx.rows), po = porOrigem(cx.rows);
      let h = '<h1>Relatório de Vendas — ' + U.esc(Store.config().empresa) + '</h1>' +
        '<div class="sub">Período: ' + U.fmtDate(cx.r.ini) + ' a ' + U.fmtDate(cx.r.fim) + ' · Gerado em ' + U.fmtDateTime(U.nowISO()) + '</div>' +
        '<div class="cards">' +
        card('Total de vendas', s.qtd) + card('Valor total', money(s.total)) + card('Valor médio', money(s.media)) +
        card('Maior venda', money(s.maior)) + card('Menor venda', money(s.menor)) + '</div>' +
        '<h2>Resumo por consultor</h2><table><tr><th>Consultor</th><th>Vendas</th><th>Valor</th></tr>' +
        pc.map(function (x) { return '<tr><td>' + U.esc(x.nome) + '</td><td>' + x.qtd + '</td><td class="num">' + money(x.valor) + '</td></tr>'; }).join('') + '</table>' +
        '<h2>Resumo por origem</h2><table><tr><th>Origem</th><th>Vendas</th><th>Valor</th></tr>' +
        po.map(function (x) { return '<tr><td>' + U.esc(x.nome) + '</td><td>' + x.qtd + '</td><td class="num">' + money(x.valor) + '</td></tr>'; }).join('') + '</table>' +
        '<h2>Vendas (' + cx.rows.length + ')</h2><table><tr><th>Data</th><th>Cliente</th><th>Telefone</th><th>Consultor</th><th>Administradora</th><th>Crédito</th><th>Parcela</th><th>Origem</th><th>Indicado por</th></tr>' +
        cx.rows.map(function (v) {
          return '<tr><td>' + U.fmtDate(v.dataVenda) + '</td><td>' + U.esc(v.cliente) + '</td><td>' + U.esc(U.fmtPhone(v.telefone)) + '</td><td>' + U.esc(C.nomeUsuario(v.consultorId)) + '</td><td>' + U.esc(v.administradora || '—') + '</td><td class="num">' + money(v.valorCredito) + '</td><td class="num">' + money(v.valorParcela) + '</td><td>' + U.esc(v.origem || '—') + '</td><td>' + (v.indicadorId ? U.esc(C.nomeIndicador(v.indicadorId)) : '—') + '</td></tr>';
        }).join('') + '</table>';
      U.openPrint('Relatório de Vendas', h);
      function card(l, v) { return '<div class="c"><span>' + l + '</span><b>' + v + '</b></div>'; }
    }

    function exportXLS() {
      const cx = compute();
      const headers = ['Data', 'Cliente', 'Telefone', 'Consultor', 'Administradora', 'Credito', 'Parcela', 'Cota', 'Origem', 'Indicado por', 'Comissao', 'Status'];
      const rows = cx.rows.map(function (v) {
        return [U.fmtDate(v.dataVenda), v.cliente, U.fmtPhone(v.telefone), C.nomeUsuario(v.consultorId), v.administradora || '',
          v.valorCredito || 0, v.valorParcela || 0, v.numeroCota || '', v.origem || '',
          v.indicadorId ? C.nomeIndicador(v.indicadorId) : '', v.comissao || 0, 'Venda Realizada'];
      });
      U.downloadBlob('relatorio-vendas-' + U.todayISO() + '.csv', 'text/csv;charset=utf-8', U.toCSV(headers, rows));
      C.toast('Arquivo Excel (CSV) gerado.');
    }

    bar.querySelector('#p').onchange = function (e) {
      state.periodo = e.target.value;
      const d = state.periodo === 'custom' ? '' : 'none';
      bar.querySelector('#di').style.display = d; bar.querySelector('#df').style.display = d; draw();
    };
    bar.querySelector('#di').onchange = function (e) { state.ini = e.target.value; draw(); };
    bar.querySelector('#df').onchange = function (e) { state.fim = e.target.value; draw(); };
    bar.querySelector('#c').onchange = function (e) { state.consultor = e.target.value; draw(); };
    bar.querySelector('#a').onchange = function (e) { state.adm = e.target.value; draw(); };
    bar.querySelector('#o').onchange = function (e) { state.origem = e.target.value; draw(); };
    bar.querySelector('#i').onchange = function (e) { state.ind = e.target.value; draw(); };
    bar.querySelector('#mn').onkeyup = function (e) { state.min = e.target.value; draw(); };
    bar.querySelector('#mx').onkeyup = function (e) { state.max = e.target.value; draw(); };
    actions.querySelector('#pdf').onclick = exportPDF;
    actions.querySelector('#xls').onclick = exportXLS;
    draw();
  }

  /* ================= RELATÓRIO DE INDICAÇÕES ================= */
  function relIndicacoes(pane) {
    const inds = Store.all('indicadores');
    const leads = Store.all('leads');
    const vendas = Store.all('vendas').filter(function (v) { return v.status === 'venda_realizada'; });
    const props = Store.all('propostas');

    const linhas = inds.map(function (ind) {
      const seusLeads = leads.filter(function (l) { return l.indicadorId === ind.id; });
      const leadIds = seusLeads.reduce(function (m, l) { m[l.id] = true; return m; }, {});
      const propostas = props.filter(function (p) { return leadIds[p.leadId]; }).length;
      const suasVendas = vendas.filter(function (v) { return v.indicadorId === ind.id || (v.leadId && leadIds[v.leadId]); });
      const valor = suasVendas.reduce(function (s, v) { return s + (Number(v.valorCredito) || 0); }, 0);
      return {
        ind: ind, leads: seusLeads.length, propostas: propostas, vendas: suasVendas.length, valor: valor,
        conv: seusLeads.length ? (suasVendas.length / seusLeads.length * 100) : 0
      };
    }).filter(function (x) { return x.leads > 0 || x.vendas > 0; });

    const totLeads = linhas.reduce(function (s, x) { return s + x.leads; }, 0);
    const totVendas = linhas.reduce(function (s, x) { return s + x.vendas; }, 0);
    const totValor = linhas.reduce(function (s, x) { return s + x.valor; }, 0);

    pane.appendChild(U.el('<div class="filters"><button class="btn ghost" id="pdf">Exportar PDF</button><button class="btn ghost" id="xls">Exportar Excel</button></div>'));

    const out = U.el('<div>' +
      '<div class="kpi-row wide">' +
      C.kpi('Leads indicados', String(totLeads)) +
      C.kpi('Vendas por indicação', String(totVendas)) +
      C.kpi('Valor vendido (indicação)', U.brlShort(totValor)) +
      C.kpi('Pessoas que indicaram', String(linhas.length)) +
      '</div>' +
      '<div class="card table-wrap"><h3 class="card-title">Indicações por pessoa</h3><table class="table"><thead><tr>' +
      '<th>Quem indicou</th><th class="num">Leads</th><th class="num">Propostas</th><th class="num">Vendas</th><th class="num">Valor vendido</th><th class="num">Conversão</th></tr></thead><tbody>' +
      linhas.sort(function (a, b) { return b.valor - a.valor; }).map(function (x) {
        return '<tr><td>' + U.esc(x.ind.nome) + '</td><td class="num">' + x.leads + '</td><td class="num">' + x.propostas + '</td>' +
          '<td class="num">' + x.vendas + '</td><td class="num">' + U.brl(x.valor) + '</td><td class="num">' + x.conv.toFixed(0) + '%</td></tr>';
      }).join('') + '</tbody></table>' + (linhas.length ? '' : '<div class="empty">Nenhuma indicação registrada.</div>') + '</div>' +
      '<div class="grid-2">' +
      rank('Quem mais indicou clientes', linhas.slice().sort(function (a, b) { return b.leads - a.leads; }), 'leads', function (v) { return v + ' leads'; }) +
      rank('Quem gerou mais vendas', linhas.slice().sort(function (a, b) { return b.valor - a.valor; }), 'valor', function (v) { return U.brlShort(v); }) +
      '</div>' +
      '</div>');
    pane.appendChild(out);

    function rank(titulo, arr, campo, fmt) {
      return '<div class="card"><h3 class="card-title">' + titulo + '</h3>' +
        (arr.length ? '<ol class="rank-list">' + arr.slice(0, 8).map(function (x) {
          return '<li><span>' + U.esc(x.ind.nome) + '</span><b>' + fmt(x[campo]) + '</b></li>';
        }).join('') + '</ol>' : '<div class="empty">Sem dados.</div>') + '</div>';
    }

    pane.querySelector('#pdf').onclick = function () {
      let h = '<h1>Relatório de Indicações — ' + U.esc(Store.config().empresa) + '</h1>' +
        '<div class="sub">Gerado em ' + U.fmtDateTime(U.nowISO()) + '</div>' +
        '<div class="cards"><div class="c"><span>Leads indicados</span><b>' + totLeads + '</b></div>' +
        '<div class="c"><span>Vendas por indicação</span><b>' + totVendas + '</b></div>' +
        '<div class="c"><span>Valor vendido</span><b>' + money(totValor) + '</b></div></div>' +
        '<h2>Indicações por pessoa</h2><table><tr><th>Quem indicou</th><th>Leads</th><th>Propostas</th><th>Vendas</th><th>Valor</th><th>Conversão</th></tr>' +
        linhas.map(function (x) { return '<tr><td>' + U.esc(x.ind.nome) + '</td><td>' + x.leads + '</td><td>' + x.propostas + '</td><td>' + x.vendas + '</td><td class="num">' + money(x.valor) + '</td><td>' + x.conv.toFixed(0) + '%</td></tr>'; }).join('') + '</table>';
      U.openPrint('Relatório de Indicações', h);
    };
    pane.querySelector('#xls').onclick = function () {
      const headers = ['Quem indicou', 'Telefone', 'Leads', 'Propostas', 'Vendas', 'Valor vendido', 'Conversao %'];
      const rows = linhas.map(function (x) { return [x.ind.nome, x.ind.telefone || '', x.leads, x.propostas, x.vendas, x.valor, x.conv.toFixed(0)]; });
      U.downloadBlob('relatorio-indicacoes-' + U.todayISO() + '.csv', 'text/csv;charset=utf-8', U.toCSV(headers, rows));
      C.toast('Arquivo Excel (CSV) gerado.');
    };
  }
})();
