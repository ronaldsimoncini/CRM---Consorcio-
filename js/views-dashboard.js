/* Dashboard — visão operacional de leads e vendas (SEM meta) */
(function () {
  function bucketVendas(vendas, modo) {
    const map = {};
    vendas.forEach(function (v) {
      const d = U.dateFromISO(v.dataVenda);
      if (!d) return;
      let key, label;
      if (modo === 'mes') { key = v.dataVenda.slice(0, 7); label = d.toLocaleDateString('pt-BR', { month: 'short' }); }
      else if (modo === 'semana') { const s = U.startOfWeek(d); key = U.iso(s); label = U.fmtDate(key).slice(0, 5); }
      else { key = v.dataVenda; label = U.fmtDate(v.dataVenda).slice(0, 5); }
      if (!map[key]) map[key] = { key: key, label: label, valor: 0, qtd: 0 };
      map[key].valor += Number(v.valorCredito) || 0;
      map[key].qtd += 1;
    });
    return Object.keys(map).sort().map(function (k) { return map[k]; }).slice(-14);
  }

  Views.dashboard = function (container) {
    container.appendChild(U.el('<div class="page-head"><h1 class="page-title">Dashboard</h1></div>'));

    const state = { periodo: '30d', consultor: '', adm: '', origem: '', grafico: 'dia', ini: '', fim: '' };

    const bar = U.el('<div class="filters">' +
      '<select id="p"><option value="hoje">Hoje</option><option value="7d">Últimos 7 dias</option>' +
      '<option value="30d" selected>Últimos 30 dias</option><option value="mes">Este mês</option>' +
      '<option value="mes_anterior">Mês anterior</option><option value="custom">Personalizado</option><option value="tudo">Tudo</option></select>' +
      '<input id="di" type="date" style="display:none"><input id="df" type="date" style="display:none">' +
      '<select id="c"><option value="">Consultor: todos</option>' + C.opts(C.usuariosConsultores(), '') + '</select>' +
      '<select id="a"><option value="">Administradora: todas</option>' + C.opts(Store.config().administradoras, '') + '</select>' +
      '<select id="o"><option value="">Origem: todas</option>' + C.opts(Store.config().origens, '') + '</select>' +
      '</div>');
    container.appendChild(bar);

    if (Auth.menu().indexOf('relatorios') >= 0) {
      const rb = U.el('<button class="btn primary" style="margin-bottom:16px">📊 Relatório de Vendas</button>');
      rb.onclick = function () { location.hash = 'relatorios'; };
      container.appendChild(rb);
    }

    const host = U.el('<div></div>');
    container.appendChild(host);

    function draw() {
      const r = state.periodo === 'tudo' ? U.range('tudo')
        : state.periodo === 'custom' ? U.range('custom', { ini: state.ini, fim: state.fim })
          : U.range(state.periodo);

      let leads = Auth.scope(Store.all('leads'));
      let vendas = Auth.scope(Store.all('vendas')).filter(function (v) { return v.status === 'venda_realizada'; });
      let props = Store.all('propostas');
      if (!Auth.canSeeAll()) props = props.filter(function (p) { return Auth.owns(p); });

      if (state.consultor) { leads = leads.filter(f('consultorId', state.consultor)); vendas = vendas.filter(f('consultorId', state.consultor)); props = props.filter(f('consultorId', state.consultor)); }
      if (state.adm) vendas = vendas.filter(f('administradora', state.adm));
      if (state.origem) { leads = leads.filter(f('origem', state.origem)); vendas = vendas.filter(f('origem', state.origem)); }

      const leadsP = leads.filter(function (l) { return U.inRange((l.criadoEm || '').slice(0, 10), r); });
      const vendasP = vendas.filter(function (v) { return U.inRange(v.dataVenda, r); });
      const propsP = props.filter(function (p) { return U.inRange((p.data || p.criadoEm || '').slice(0, 10), r); });

      const emAtend = leads.filter(function (l) { return ['primeira_ligacao', 'reuniao_agendada', 'reuniao_realizada', 'proposta_realizada'].indexOf(l.etapa) >= 0; }).length;
      const novos = leads.filter(function (l) { return l.etapa === 'novo'; }).length;
      const valorVendido = vendasP.reduce(function (s, v) { return s + (Number(v.valorCredito) || 0); }, 0);

      let html = '<div class="kpi-row wide">' +
        C.kpi('Total de leads', String(leads.length)) +
        C.kpi('Novos leads', String(novos)) +
        C.kpi('Leads em atendimento', String(emAtend)) +
        C.kpi('Propostas', String(propsP.length), 'no período') +
        C.kpi('Vendas realizadas', String(vendasP.length), 'no período') +
        C.kpi('Valor total vendido', U.brlShort(valorVendido), 'no período') +
        '</div>';

      /* funil resumido */
      html += '<div class="card"><h3 class="card-title">Funil de leads</h3><div class="funnel-mini">' +
        Store.etapas().map(function (e) {
          const n = leads.filter(function (l) { return l.etapa === e.key; }).length;
          return '<div class="fm-item"><div class="fm-n">' + n + '</div><div class="fm-l">' + e.label + '</div></div>';
        }).join('') + '</div></div>';

      /* gráfico de vendas */
      html += '<div class="card"><div class="card-title-row"><h3 class="card-title">Vendas no período</h3>' +
        '<div class="seg"><button data-g="dia" class="' + (state.grafico === 'dia' ? 'on' : '') + '">Dia</button>' +
        '<button data-g="semana" class="' + (state.grafico === 'semana' ? 'on' : '') + '">Semana</button>' +
        '<button data-g="mes" class="' + (state.grafico === 'mes' ? 'on' : '') + '">Mês</button></div></div>' +
        C.barChart(bucketVendas(vendasP, state.grafico)) + '</div>';

      /* origem dos leads + desempenho consultores lado a lado */
      const origemAgg = {};
      leadsP.forEach(function (l) { const o = l.origem || 'Outros'; origemAgg[o] = (origemAgg[o] || 0) + 1; });
      const origemItems = Object.keys(origemAgg).map(function (k) { return { label: k, valor: origemAgg[k] }; })
        .sort(function (a, b) { return b.valor - a.valor; });

      html += '<div class="grid-2">' +
        '<div class="card"><h3 class="card-title">Origem dos leads</h3>' + C.hBars(origemItems) +
        '<div class="muted" id="ver-ind" style="cursor:pointer;text-decoration:underline">Ver quem indicou</div></div>' +
        '<div class="card"><h3 class="card-title">Desempenho dos consultores</h3><div class="table-wrap"><table class="table"><thead><tr>' +
        '<th>Consultor</th><th class="num">Leads</th><th class="num">Propostas</th><th class="num">Vendas</th><th class="num">Valor</th></tr></thead><tbody>' +
        C.usuariosConsultores().map(function (o) {
          const nl = leadsP.filter(f('consultorId', o.value)).length;
          const np = propsP.filter(f('consultorId', o.value)).length;
          const vs = vendasP.filter(f('consultorId', o.value));
          const val = vs.reduce(function (s, v) { return s + (Number(v.valorCredito) || 0); }, 0);
          if (!nl && !np && !vs.length) return '';
          return '<tr><td>' + U.esc(o.label) + '</td><td class="num">' + nl + '</td><td class="num">' + np + '</td><td class="num">' + vs.length + '</td><td class="num">' + U.brlShort(val) + '</td></tr>';
        }).join('') + '</tbody></table></div></div></div>';

      /* vendas recentes */
      html += '<div class="card"><h3 class="card-title">Vendas recentes</h3><div class="recent-list" id="rv"></div></div>';

      /* leads recentes */
      html += '<div class="card"><h3 class="card-title">Leads recentes</h3><div class="table-wrap"><table class="table"><thead><tr>' +
        '<th>Nome</th><th>Telefone</th><th>Origem</th><th>Indicado por</th><th>Consultor</th><th>Etapa</th><th>Entrada</th></tr></thead><tbody id="rl"></tbody></table></div></div>';

      host.innerHTML = html;

      /* vendas recentes (cards) */
      const rv = host.querySelector('#rv');
      const recV = vendasP.slice().sort(function (a, b) { return (b.dataVenda || '') < (a.dataVenda || '') ? -1 : 1; }).slice(0, 8);
      if (!recV.length) rv.innerHTML = '<div class="empty">Nenhuma venda no período.</div>';
      recV.forEach(function (v) {
        rv.appendChild(U.el('<div class="recent-card">' +
          '<div class="rc-top"><b>' + U.esc(v.cliente) + '</b><span>' + U.fmtDate(v.dataVenda) + '</span></div>' +
          '<div class="rc-grid">' +
          '<span>📞 ' + U.esc(U.fmtPhone(v.telefone)) + '</span>' +
          '<span>👤 ' + U.esc(C.nomeUsuario(v.consultorId)) + '</span>' +
          '<span>🏦 ' + U.esc(v.administradora || '—') + '</span>' +
          '<span>💰 ' + U.brlShort(v.valorCredito) + '</span>' +
          '<span>📄 parcela ' + U.brl(v.valorParcela) + '</span>' +
          '<span>🎟️ cota ' + U.esc(v.numeroCota || '—') + '</span>' +
          '<span>📍 ' + U.esc(v.origem || '—') + '</span>' +
          (v.indicadorId ? '<span>🤝 Indicado por: ' + U.esc(C.nomeIndicador(v.indicadorId)) + '</span>' : '') +
          '</div></div>'));
      });

      /* leads recentes */
      const rl = host.querySelector('#rl');
      const recL = leadsP.slice().sort(function (a, b) { return (b.criadoEm || '') < (a.criadoEm || '') ? -1 : 1; }).slice(0, 10);
      if (!recL.length) rl.innerHTML = '<tr><td colspan="7"><div class="empty">Nenhum lead no período.</div></td></tr>';
      recL.forEach(function (l) {
        const tr = U.el('<tr style="cursor:pointer"><td>' + U.esc(l.nome) + '</td><td>' + U.esc(U.fmtPhone(l.telefone)) + '</td>' +
          '<td>' + U.esc(l.origem || '—') + '</td><td>' + (l.indicadorId ? U.esc(C.nomeIndicador(l.indicadorId)) : '—') + '</td>' +
          '<td>' + U.esc(C.nomeUsuario(l.consultorId)) + '</td><td>' + Store.etapaLabel(l.etapa) + '</td><td>' + U.fmtDate(l.criadoEm) + '</td></tr>');
        tr.onclick = function () { Views._lead.openModal(l.id); };
        rl.appendChild(tr);
      });

      host.querySelectorAll('.seg button').forEach(function (b) {
        b.onclick = function () { state.grafico = b.dataset.g; draw(); };
      });
      const vi = host.querySelector('#ver-ind');
      if (vi) vi.onclick = function () {
        const agg = {};
        Store.all('leads').filter(function (l) { return l.origem === 'Indicação' && l.indicadorId; })
          .forEach(function (l) { agg[l.indicadorId] = (agg[l.indicadorId] || 0) + 1; });
        const items = Object.keys(agg).map(function (id) { return { label: C.nomeIndicador(id), valor: agg[id] }; }).sort(function (a, b) { return b.valor - a.valor; });
        C.modal('Quem indicou', U.el('<div>' + (items.length ? C.hBars(items) : '<div class="empty">Nenhuma indicação registrada.</div>') + '</div>'), {});
      };
    }
    function f(k, val) { return function (x) { return x[k] === val; }; }

    bar.querySelector('#p').onchange = function (e) {
      state.periodo = e.target.value;
      const show = state.periodo === 'custom' ? '' : 'none';
      bar.querySelector('#di').style.display = show; bar.querySelector('#df').style.display = show;
      draw();
    };
    bar.querySelector('#di').onchange = function (e) { state.ini = e.target.value; draw(); };
    bar.querySelector('#df').onchange = function (e) { state.fim = e.target.value; draw(); };
    bar.querySelector('#c').onchange = function (e) { state.consultor = e.target.value; draw(); };
    bar.querySelector('#a').onchange = function (e) { state.adm = e.target.value; draw(); };
    bar.querySelector('#o').onchange = function (e) { state.origem = e.target.value; draw(); };
    draw();
  };
})();
