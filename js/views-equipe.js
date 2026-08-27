/* Desempenho dos consultores (controle e relatório — sem ranking/comparação) */
(function () {
  function consultores() {
    return Store.all('usuarios').filter(function (u) { return u.nivel === 'consultor' || u.nivel === 'gestor' || u.nivel === 'admin'; });
  }

  /* ================= CONSULTORES (desempenho individual) ================= */
  Views.consultores = function (container) {
    container.appendChild(U.el('<div class="page-head"><h1 class="page-title">Consultores</h1></div>'));

    const bar = U.el('<div class="filters">' +
      '<select id="p"><option value="tudo">Todo o período</option><option value="mes">Este mês</option><option value="30d">Últimos 30 dias</option><option value="ano">Este ano</option></select>' +
      '</div>');
    container.appendChild(bar);
    const host = U.el('<div></div>');
    container.appendChild(host);

    function draw() {
      const pv = bar.querySelector('#p').value;
      const r = pv === 'tudo' ? U.range('tudo') : U.range(pv);
      const leads = Store.all('leads').filter(function (l) { return U.inRange((l.criadoEm || '').slice(0, 10), r); });
      const props = Store.all('propostas').filter(function (p) { return U.inRange((p.data || p.criadoEm || '').slice(0, 10), r); });
      const vendas = Store.all('vendas').filter(function (v) { return v.status === 'venda_realizada' && U.inRange(v.dataVenda, r); });

      const rows = consultores().map(function (u) {
        const nl = leads.filter(function (l) { return l.consultorId === u.id; }).length;
        const np = props.filter(function (p) { return p.consultorId === u.id; }).length;
        const vs = vendas.filter(function (v) { return v.consultorId === u.id; });
        const valor = vs.reduce(function (s, v) { return s + (Number(v.valorCredito) || 0); }, 0);
        return { u: u, nl: nl, np: np, nv: vs.length, valor: valor };
      }).sort(function (a, b) { return (a.u.nome || '').localeCompare(b.u.nome || ''); });

      host.innerHTML = '<div class="card table-wrap"><table class="table"><thead><tr><th>Consultor</th><th>Nível</th>' +
        '<th class="num">Leads recebidos</th><th class="num">Propostas</th><th class="num">Vendas</th><th class="num">Valor vendido</th></tr></thead><tbody>' +
        rows.map(function (x) {
          return '<tr><td>' + U.esc(x.u.nome) + '</td><td>' + U.esc(x.u.nivel) + '</td><td class="num">' + x.nl + '</td>' +
            '<td class="num">' + x.np + '</td><td class="num">' + x.nv + '</td><td class="num">' + U.brl(x.valor) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    bar.querySelector('#p').onchange = draw;
    draw();
  };
})();
