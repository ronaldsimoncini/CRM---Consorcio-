/* Relatórios — Vendas e Indicações, com exportação PDF/Excel */
(function () {
  function money(n) { return U.brl(n); }

  Views.relatorios = function (container) {
    container.appendChild(U.el('<div class="page-head"><h1 class="page-title">Relatórios</h1></div>'));
    const host = U.el('<div></div>');
    container.appendChild(host);
    C.tabs(host, [
      { key: 'comercial', label: '📈 Relatório Comercial' },
      { key: 'vendas', label: '📊 Relatório de Vendas' },
      { key: 'indic', label: '🤝 Relatório de Indicações' }
    ], function (key) {
      let pane = host.querySelector('.tabpane');
      if (!pane) { pane = U.el('<div class="tabpane"></div>'); host.appendChild(pane); }
      pane.innerHTML = '';
      if (key === 'comercial') relComercial(pane);
      else if (key === 'vendas') relVendas(pane);
      else relIndicacoes(pane);
    }, 'rel');
  };

  /* ================= RELATÓRIO COMERCIAL (completo) =================
     Visão comercial completa do CRM: indicadores oficiais, funil (com
     etapas dinâmicas, inclusive customizadas), Boleto e Assinatura,
     vendas, desempenho por consultor, origens, detalhamento de leads e
     histórico. Exporta PDF (via U.openPrint, HTML/CSS de impressão) e
     Excel .xlsx real com múltiplas abas (via SheetJS, carregado no
     index.html). TUDO parte de dados já filtrados por Auth.scope() —
     nenhuma função deste bloco lê Store.all(...) sem passar por ele. */

  /* NÃO calcular como constante de módulo: Store.etapaLabel() só reflete o nome real
     depois do Store.hydrate() (assíncrono) terminar. Recalcular a cada uso, como o
     Dashboard já faz, evita pegar o fallback (a key) se o relatório renderizar antes
     da hidratação. */
  function labelEtapaBoleto() { return 'para ' + Store.etapaLabel('boleto_e_assinatura'); }
  const ETAPAS_ATENDIMENTO = ['primeira_ligacao', 'reuniao_agendada', 'reuniao_realizada', 'proposta_realizada'];

  /* ---------- base filtrada: calculada UMA VEZ, reaproveitada pela tela, PDF e Excel ---------- */
  function comercialBase(state) {
    const r = state.periodo === 'tudo' ? U.range('tudo')
      : state.periodo === 'custom' ? U.range('custom', { ini: state.ini, fim: state.fim })
        : U.range(state.periodo);

    /* mapa auth_uid -> id de negócio do usuário, para resolver o "dono" (owner_uid)
       de reuniões/vendas/propostas quando o filtro de consultor é por id de negócio */
    const usuarioPorAuthUid = {};
    Store.all('usuarios').forEach(function (u) { if (u.authUid) usuarioPorAuthUid[u.authUid] = u.id; });
    function consultorDe(rec) {
      if (rec.consultorId) return rec.consultorId;
      if (rec.owner_uid && usuarioPorAuthUid[rec.owner_uid]) return usuarioPorAuthUid[rec.owner_uid];
      return null;
    }

    let leads = Auth.scope(Store.all('leads'));
    let vendas = Auth.scope(Store.all('vendas')).filter(function (v) { return v.status === 'venda_realizada'; });
    let propostas = Store.all('propostas');
    if (!Auth.canSeeAll()) propostas = propostas.filter(function (p) { return Auth.owns(p); });
    let reunioes = Auth.scope(Store.all('reunioes'));

    if (state.consultor) {
      leads = leads.filter(function (l) { return l.consultorId === state.consultor; });
      vendas = vendas.filter(function (v) { return v.consultorId === state.consultor; });
      propostas = propostas.filter(function (p) { return p.consultorId === state.consultor; });
      reunioes = reunioes.filter(function (x) { return consultorDe(x) === state.consultor; });
    }
    if (state.adm) { vendas = vendas.filter(function (v) { return v.administradora === state.adm; }); }
    if (state.origem) {
      leads = leads.filter(function (l) { return l.origem === state.origem; });
      vendas = vendas.filter(function (v) { return v.origem === state.origem; });
    }
    if (state.ind) {
      vendas = vendas.filter(function (v) { return v.indicadorId === state.ind; });
      leads = leads.filter(function (l) { return l.indicadorId === state.ind; });
    }

    const leadsPorId = {};
    leads.forEach(function (l) { leadsPorId[l.id] = l; });

    /* origem/consultor em propostas e reuniões: propostas não têm "origem" própria,
       reuniões não têm "consultorId"/"origem" próprios quando criadas fora do Funil —
       nesses casos a referência é o leadId, contra o conjunto JÁ filtrado de leads.
       Isso preserva o escopo/filtro sem inventar campos que não existem. */
    if (state.origem || state.ind) {
      propostas = propostas.filter(function (p) { return !p.leadId || leadsPorId[p.leadId]; });
      reunioes = reunioes.filter(function (x) { return !x.leadId || leadsPorId[x.leadId]; });
    }

    const leadsP = leads.filter(function (l) { return U.inRange((l.criadoEm || '').slice(0, 10), r); });
    const vendasP = vendas.filter(function (v) { return U.inRange(v.dataVenda, r); });
    const propostasP = propostas.filter(function (p) { return U.inRange((p.data || p.criadoEm || '').slice(0, 10), r); });
    const reunioesP = reunioes.filter(function (x) { return U.inRange(x.data, r); });
    const historico = Store.all('historico').filter(function (h) { return leadsPorId[h.leadId]; }); // segurança: só histórico de leads no escopo/filtro

    return { r: r, leads: leads, leadsP: leadsP, leadsPorId: leadsPorId, vendas: vendas, vendasP: vendasP,
      propostas: propostas, propostasP: propostasP, reunioes: reunioes, reunioesP: reunioesP, historico: historico,
      consultorDe: consultorDe };
  }

  /* ---------- Parte 2: indicadores oficiais ---------- */
  function comercialIndicadores(cx) {
    const leads = cx.leads;
    const totalLeads = leads.length;
    const novos = leads.filter(function (l) { return l.etapa === 'novo'; }).length;
    const emAtendimento = leads.filter(function (l) { return ETAPAS_ATENDIMENTO.indexOf(l.etapa) >= 0; }).length;
    const primeiraLigacao = leads.filter(function (l) { return l.etapa === 'primeira_ligacao'; }).length;
    const reuniaoAgendadas = cx.reunioes.filter(function (x) { return x.status === 'agendada'; }).length;
    const reuniaoRealizadas = cx.reunioes.filter(function (x) { return x.status === 'realizada'; }).length;
    const qtdPropostas = cx.propostas.length;
    const leadsComProposta = Object.keys(cx.propostas.reduce(function (m, p) { if (p.leadId) m[p.leadId] = true; return m; }, {})).length;
    const fechamentos = leads.filter(function (l) { return l.etapa === 'fechamento'; }).length;
    const leadsBoleto = leads.filter(function (l) { return l.etapa === 'boleto_e_assinatura'; });
    const clientesBoleto = leadsBoleto.length;
    const valorBoleto = leadsBoleto.reduce(function (s, l) { return s + (Number(l.valorCredito) || 0); }, 0);
    const vendasRealizadas = cx.vendasP.length;
    const valorVendido = cx.vendasP.reduce(function (s, v) { return s + (Number(v.valorCredito) || 0); }, 0);
    return {
      totalLeads: totalLeads, novos: novos, emAtendimento: emAtendimento, primeiraLigacao: primeiraLigacao,
      reuniaoAgendadas: reuniaoAgendadas, reuniaoRealizadas: reuniaoRealizadas, qtdPropostas: qtdPropostas,
      leadsComProposta: leadsComProposta, fechamentos: fechamentos, clientesBoleto: clientesBoleto,
      valorBoleto: valorBoleto, vendasRealizadas: vendasRealizadas, valorVendido: valorVendido
    };
  }

  /* ---------- Parte 3: funil (etapas dinâmicas, Store.etapas(), nunca lista fixa) ---------- */
  function comercialFunil(cx) {
    const total = cx.leads.length;
    return Store.etapas().map(function (e) {
      const qtd = cx.leads.filter(function (l) { return l.etapa === e.key; }).length;
      return { key: e.key, label: e.label, qtd: qtd, pct: total ? (qtd / total * 100) : 0 };
    });
  }

  /* ---------- Parte 4: Boleto e Assinatura (estado atual x entradas no período) ----------
     Mesma identificação já usada no Dashboard: historico.tipo==='mudanca_etapa' e texto
     terminando em "para " + label atual da etapa. Sensível a renomeação futura — não
     alterado aqui, como instruído. */
  function comercialEntradasBoleto(cx) {
    const sufixo = labelEtapaBoleto();
    return cx.historico.filter(function (h) {
      return h.tipo === 'mudanca_etapa' && typeof h.texto === 'string' && h.texto.endsWith(sufixo) &&
        h.data && U.inRange(h.data, cx.r);
    });
  }
  function comercialBoleto(cx) {
    const leadsBoleto = cx.leads.filter(function (l) { return l.etapa === 'boleto_e_assinatura'; });
    const entradas = comercialEntradasBoleto(cx);
    const porDia = {};
    entradas.forEach(function (h) {
      const k = String(h.data).slice(0, 10);
      porDia[k] = (porDia[k] || 0) + 1;
    });
    const evolucao = Object.keys(porDia).sort().map(function (k) {
      return { key: k, label: U.fmtDate(k).slice(0, 5), valor: porDia[k], qtd: porDia[k] };
    }).slice(-30);
    return {
      atual: leadsBoleto.length,
      valorAtual: leadsBoleto.reduce(function (s, l) { return s + (Number(l.valorCredito) || 0); }, 0),
      entradasPeriodo: entradas.length,
      evolucao: evolucao
    };
  }

  /* ---------- Parte 5: vendas ---------- */
  function comercialVendas(cx) {
    const rows = cx.vendasP;
    const total = rows.reduce(function (s, v) { return s + (Number(v.valorCredito) || 0); }, 0);
    function agrupar(campo, rotuloVazio) {
      const m = {};
      rows.forEach(function (v) {
        const k = v[campo] || rotuloVazio;
        if (!m[k]) m[k] = { nome: k, qtd: 0, valor: 0 };
        m[k].qtd++; m[k].valor += Number(v.valorCredito) || 0;
      });
      return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.valor - a.valor; });
    }
    const porConsultorBruto = {};
    rows.forEach(function (v) {
      const k = v.consultorId || '—';
      if (!porConsultorBruto[k]) porConsultorBruto[k] = { nome: C.nomeUsuario(v.consultorId), qtd: 0, valor: 0 };
      porConsultorBruto[k].qtd++; porConsultorBruto[k].valor += Number(v.valorCredito) || 0;
    });
    const porMes = {};
    rows.forEach(function (v) {
      const k = (v.dataVenda || '').slice(0, 7);
      if (!k) return;
      if (!porMes[k]) porMes[k] = { key: k, label: k, valor: 0, qtd: 0 };
      porMes[k].valor += Number(v.valorCredito) || 0; porMes[k].qtd++;
    });
    return {
      qtd: rows.length, valor: total,
      porConsultor: Object.keys(porConsultorBruto).map(function (k) { return porConsultorBruto[k]; }).sort(function (a, b) { return b.valor - a.valor; }),
      porAdministradora: agrupar('administradora', 'Sem administradora'),
      porOrigem: agrupar('origem', 'Outros'),
      evolucao: Object.keys(porMes).sort().map(function (k) { return porMes[k]; }).slice(-14)
    };
  }

  /* ---------- Parte 6: desempenho por consultor (respeita escopo) ---------- */
  function comercialConsultores(cx) {
    const todos = C.usuariosConsultores();
    const visiveis = Auth.canSeeAll() ? todos : todos.filter(function (u) { return u.value === Auth.currentId(); });
    return visiveis.map(function (u) {
      const meusLeads = cx.leads.filter(function (l) { return l.consultorId === u.value; });
      const meusVendas = cx.vendasP.filter(function (v) { return v.consultorId === u.value; });
      return {
        nome: u.label,
        leads: meusLeads.length,
        primeiraLigacao: meusLeads.filter(function (l) { return l.etapa === 'primeira_ligacao'; }).length,
        reunioes: cx.reunioes.filter(function (x) { return cx.consultorDe(x) === u.value; }).length,
        propostas: cx.propostas.filter(function (p) { return p.consultorId === u.value; }).length,
        fechamentos: meusLeads.filter(function (l) { return l.etapa === 'fechamento'; }).length,
        boleto: meusLeads.filter(function (l) { return l.etapa === 'boleto_e_assinatura'; }).length,
        vendas: meusVendas.length,
        valor: meusVendas.reduce(function (s, v) { return s + (Number(v.valorCredito) || 0); }, 0)
      };
    }).sort(function (a, b) { return b.valor - a.valor; });
  }

  /* ---------- Parte 7: origens (a venda usa a própria origem registrada, nunca inferida) ---------- */
  function comercialOrigens(cx) {
    const m = {};
    cx.leads.forEach(function (l) {
      const k = l.origem || 'Outros';
      if (!m[k]) m[k] = { nome: k, leads: 0, vendas: 0, valor: 0 };
      m[k].leads++;
    });
    cx.vendasP.forEach(function (v) {
      const k = v.origem || 'Outros';
      if (!m[k]) m[k] = { nome: k, leads: 0, vendas: 0, valor: 0 };
      m[k].vendas++; m[k].valor += Number(v.valorCredito) || 0;
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.leads - a.leads; });
  }

  /* ---------- Parte 9/10: detalhamento dos leads + histórico ----------
     Entrada em Boleto e Assinatura por lead: a mesma identificação por texto
     do histórico (Parte 4), pegando o evento MAIS RECENTE de entrada daquele
     lead especificamente — reconstrução best-effort, não garantida se a
     etapa já foi renomeada no passado (mesma limitação já documentada). */
  function comercialLeadsDetalhe(cx) {
    const sufixoBoleto = labelEtapaBoleto();
    const entradasPorLead = {};
    cx.historico.forEach(function (h) {
      if (h.tipo === 'mudanca_etapa' && typeof h.texto === 'string' && h.texto.endsWith(sufixoBoleto) && h.data) {
        if (!entradasPorLead[h.leadId] || h.data > entradasPorLead[h.leadId]) entradasPorLead[h.leadId] = h.data;
      }
    });
    return cx.leads.map(function (l) {
      const venda = l.vendaId ? Store.get('vendas', l.vendaId) : null;
      return {
        id: l.id, nome: l.nome || '', telefone: l.telefone || '', whatsapp: l.whatsapp || '', email: l.email || '',
        cidade: l.cidade || '', consultor: C.nomeUsuario(l.consultorId), origem: l.origem || '',
        indicador: l.indicadorId ? C.nomeIndicador(l.indicadorId) : '', etapa: Store.etapaLabel(l.etapa),
        etapaKey: l.etapa, valorCredito: l.valorCredito || 0, qualificacao: Store.qualificacaoLabel(l.qualificacao) || '',
        criadoEm: l.criadoEm || '', atualizadoEm: l.atualizadoEm || '', proximoContato: l.proximoContato || '',
        obs: l.obs || '',
        reuniaoData: (l.reuniao && l.reuniao.data) || '', reuniaoHora: (l.reuniao && l.reuniao.hora) || '',
        propostaData: (l.proposta && l.proposta.data) || '', propostaValor: (l.proposta && l.proposta.valorCredito) || '',
        vendaData: venda ? venda.dataVenda : '', vendaValor: venda ? venda.valorCredito : '',
        emBoleto: l.etapa === 'boleto_e_assinatura' ? 'Sim' : 'Não',
        entradaBoleto: entradasPorLead[l.id] || '',
        historicoResumo: (function () { const h = Store.historyOf(l.id); return h.length ? (h.length + ' evento(s); último: ' + U.fmtDateTime(h[0].data) + ' — ' + h[0].texto) : ''; })()
      };
    });
  }
  function comercialHistoricoLinhas(cx) {
    return cx.historico.slice().sort(function (a, b) { return (b.data || '') < (a.data || '') ? -1 : 1; })
      .map(function (h) {
        const l = cx.leadsPorId[h.leadId];
        return { data: h.data, lead: l ? l.nome : '—', tipo: h.tipo, texto: h.texto, usuario: C.nomeUsuario(h.usuarioId) };
      });
  }

  function linhaKpi(label, valor) {
    return '<tr><td>' + U.esc(label) + '</td><td class="num"><b>' + U.esc(String(valor)) + '</b></td></tr>';
  }
  function tabelaSimples(titulo, arr, campoNome) {
    return '<div class="card"><h3 class="card-title">' + U.esc(titulo) + '</h3>' +
      (arr.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Nome</th><th class="num">Qtd.</th><th class="num">Valor</th></tr></thead><tbody>' +
        arr.map(function (x) { return '<tr><td>' + U.esc(x[campoNome]) + '</td><td class="num">' + x.qtd + '</td><td class="num">' + U.brl(x.valor) + '</td></tr>'; }).join('') +
        '</tbody></table></div>' : '<div class="empty">Sem dados no período.</div>') + '</div>';
  }
  function filtrosTexto(state) {
    const partes = [];
    if (state.consultor) partes.push('Consultor: ' + C.nomeUsuario(state.consultor));
    if (state.adm) partes.push('Administradora: ' + state.adm);
    if (state.origem) partes.push('Origem: ' + state.origem);
    if (state.ind) partes.push('Indicado por: ' + C.nomeIndicador(state.ind));
    return partes.length ? partes.join(' · ') : 'Nenhum filtro adicional';
  }

  /* ================= TELA: RELATÓRIO COMERCIAL ================= */
  function relComercial(pane) {
    const state = { periodo: '30d', ini: '', fim: '', consultor: '', adm: '', origem: '', ind: '' };

    const bar = U.el('<div class="filters">' +
      '<select id="p"><option value="hoje">Hoje</option><option value="7d">Últimos 7 dias</option>' +
      '<option value="30d" selected>Últimos 30 dias</option><option value="mes">Este mês</option>' +
      '<option value="mes_anterior">Mês anterior</option><option value="custom">Personalizado</option><option value="tudo">Tudo</option></select>' +
      '<input id="di" type="date" style="display:none"><input id="df" type="date" style="display:none">' +
      '<select id="c"><option value="">Consultor: todos</option>' + C.opts(C.usuariosConsultores(), '') + '</select>' +
      '<select id="a"><option value="">Administradora: todas</option>' + C.opts(Store.config().administradoras, '') + '</select>' +
      '<select id="o"><option value="">Origem: todas</option>' + C.opts(Store.config().origens, '') + '</select>' +
      '<select id="i"><option value="">Indicado por: todos</option>' + C.opts(Store.all('indicadores').map(function (x) { return { value: x.id, label: x.nome }; }), '') + '</select>' +
      '</div>');
    pane.appendChild(bar);

    const actions = U.el('<div class="filters">' +
      '<button class="btn primary" id="pdf">📄 Exportar PDF</button>' +
      '<button class="btn ghost" id="xls">📊 Exportar Excel (.xlsx)</button>' +
      '</div>');
    pane.appendChild(actions);

    const out = U.el('<div></div>');
    pane.appendChild(out);

    function draw() {
      const cx = comercialBase(state);
      const ind = comercialIndicadores(cx);
      const funil = comercialFunil(cx);
      const boleto = comercialBoleto(cx);
      const vendas = comercialVendas(cx);
      const consultores = comercialConsultores(cx);
      const origens = comercialOrigens(cx);
      const detalhe = comercialLeadsDetalhe(cx);

      let html = '<div class="sub muted">Período analisado: ' + U.fmtDate(cx.r.ini) + ' a ' + U.fmtDate(cx.r.fim) +
        ' · Filtros: ' + U.esc(filtrosTexto(state)) + '</div>';

      html += '<div class="kpi-row wide">' +
        C.kpi('Total de leads', String(ind.totalLeads)) +
        C.kpi('Vendas realizadas', String(ind.vendasRealizadas), 'no período') +
        C.kpi('Valor vendido', U.brlShort(ind.valorVendido), 'no período') +
        C.kpi('Clientes em Boleto e Assinatura', String(ind.clientesBoleto), 'estado atual') +
        C.kpi('Valor em Boleto e Assinatura', U.brlShort(ind.valorBoleto), 'estado atual') +
        '</div>';

      html += '<div class="card"><h3 class="card-title">Indicadores do funil</h3><div class="table-wrap"><table class="table"><tbody>' +
        linhaKpi('Novos leads', ind.novos) +
        linhaKpi('Leads em atendimento', ind.emAtendimento) +
        linhaKpi('Primeira ligação', ind.primeiraLigacao) +
        linhaKpi('Reuniões agendadas', ind.reuniaoAgendadas) +
        linhaKpi('Reuniões realizadas', ind.reuniaoRealizadas) +
        linhaKpi('Propostas registradas', ind.qtdPropostas) +
        linhaKpi('Leads com proposta', ind.leadsComProposta) +
        linhaKpi('Fechamentos (etapa atual — não é o mesmo que venda realizada)', ind.fechamentos) +
        '</tbody></table></div>' +
        '<div class="muted" style="margin-top:8px;font-size:12px">"Não respondeu à cadência" não possui uma etapa estruturada no CRM hoje — não é exibido como indicador oficial, para evitar um número inventado.</div>' +
        '</div>';

      html += '<div class="card"><h3 class="card-title">Funil comercial</h3><div class="table-wrap"><table class="table"><thead><tr><th>Etapa</th><th class="num">Quantidade</th><th class="num">%</th></tr></thead><tbody>' +
        funil.map(function (e) { return '<tr><td>' + U.esc(e.label) + '</td><td class="num">' + e.qtd + '</td><td class="num">' + e.pct.toFixed(1) + '%</td></tr>'; }).join('') +
        '</tbody></table></div>' +
        C.barChart(funil.map(function (e) { return { key: e.key, label: e.label.slice(0, 10), valor: e.qtd, qtd: e.qtd }; })) +
        '</div>';

      html += '<div class="card"><h3 class="card-title">Boleto e Assinatura</h3>' +
        '<div class="kpi-row wide">' +
        C.kpi('Clientes atualmente', String(boleto.atual), 'estado atual') +
        C.kpi('Valor atual', U.brlShort(boleto.valorAtual), 'estado atual') +
        C.kpi('Entradas no período', String(boleto.entradasPeriodo), 'evento') +
        '</div>' +
        '<div class="muted" style="font-size:12px;margin-bottom:6px">Evolução das entradas (por dia) no período selecionado:</div>' +
        C.barChart(boleto.evolucao) + '</div>';

      html += '<div class="card"><h3 class="card-title">Vendas</h3>' +
        '<div class="kpi-row wide">' + C.kpi('Quantidade', String(vendas.qtd)) + C.kpi('Valor vendido', U.brlShort(vendas.valor)) + '</div>' +
        '<div class="muted" style="font-size:12px;margin-bottom:6px">Evolução mensal:</div>' + C.barChart(vendas.evolucao) +
        '<div class="grid-2">' + tabelaSimples('Por consultor', vendas.porConsultor, 'nome') + tabelaSimples('Por administradora', vendas.porAdministradora, 'nome') + '</div>' +
        tabelaSimples('Por origem', vendas.porOrigem, 'nome') +
        '</div>';

      html += '<div class="card"><h3 class="card-title">Desempenho por consultor</h3><div class="table-wrap"><table class="table"><thead><tr>' +
        '<th>Consultor</th><th class="num">Leads</th><th class="num">1ª Ligação</th><th class="num">Reuniões</th><th class="num">Propostas</th><th class="num">Fechamentos</th><th class="num">Boleto</th><th class="num">Vendas</th><th class="num">Valor</th></tr></thead><tbody>' +
        consultores.map(function (x) {
          return '<tr><td>' + U.esc(x.nome) + '</td><td class="num">' + x.leads + '</td><td class="num">' + x.primeiraLigacao + '</td><td class="num">' + x.reunioes +
            '</td><td class="num">' + x.propostas + '</td><td class="num">' + x.fechamentos + '</td><td class="num">' + x.boleto + '</td><td class="num">' + x.vendas +
            '</td><td class="num">' + U.brl(x.valor) + '</td></tr>';
        }).join('') + '</tbody></table></div>' + (consultores.length ? '' : '<div class="empty">Sem consultores no escopo atual.</div>') + '</div>';

      html += '<div class="card"><h3 class="card-title">Origens</h3><div class="table-wrap"><table class="table"><thead><tr><th>Origem</th><th class="num">Leads</th><th class="num">Vendas</th><th class="num">Valor</th></tr></thead><tbody>' +
        origens.map(function (x) { return '<tr><td>' + U.esc(x.nome) + '</td><td class="num">' + x.leads + '</td><td class="num">' + x.vendas + '</td><td class="num">' + U.brl(x.valor) + '</td></tr>'; }).join('') +
        '</tbody></table></div>' + (origens.length ? '' : '<div class="empty">Sem dados.</div>') + '</div>';

      html += '<div class="card table-wrap"><h3 class="card-title">Detalhamento dos leads (' + detalhe.length + ')</h3><table class="table"><thead><tr>' +
        '<th>Nome</th><th>Telefone</th><th>Consultor</th><th>Origem</th><th>Etapa</th><th class="num">Valor</th><th>Criado em</th></tr></thead><tbody>' +
        detalhe.slice(0, 200).map(function (d) {
          return '<tr><td>' + U.esc(d.nome) + '</td><td>' + U.esc(U.fmtPhone(d.telefone)) + '</td><td>' + U.esc(d.consultor) + '</td><td>' + U.esc(d.origem || '—') +
            '</td><td>' + U.esc(d.etapa) + '</td><td class="num">' + U.brl(d.valorCredito) + '</td><td>' + U.fmtDate(d.criadoEm) + '</td></tr>';
        }).join('') + '</tbody></table>' +
        (detalhe.length > 200 ? '<div class="muted" style="margin-top:6px">Mostrando 200 de ' + detalhe.length + ' leads na tela — a lista completa está no PDF e no Excel.</div>' : '') +
        (detalhe.length ? '' : '<div class="empty">Nenhum lead no filtro atual.</div>') +
        '</div>';

      out.innerHTML = html;
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
    actions.querySelector('#pdf').onclick = function () { exportComercialPDF(state); };
    actions.querySelector('#xls').onclick = function () { exportComercialXLSX(state); };
    draw();
  }

  /* ================= EXPORTAÇÃO: PDF (U.openPrint, sem biblioteca nova) ================= */
  function exportComercialPDF(state) {
    const cx = comercialBase(state);
    const ind = comercialIndicadores(cx);
    const funil = comercialFunil(cx);
    const boleto = comercialBoleto(cx);
    const vendas = comercialVendas(cx);
    const consultores = comercialConsultores(cx);
    const origens = comercialOrigens(cx);
    const detalhe = comercialLeadsDetalhe(cx);
    function card(l, v) { return '<div class="c"><span>' + U.esc(l) + '</span><b>' + v + '</b></div>'; }

    let h = '<div class="capa">' +
      '<h1>' + U.esc(Store.config().empresa || 'CRM') + '</h1>' +
      '<div class="sub" style="font-size:16px;font-weight:600;color:#1E2D47">Relatório Comercial</div>' +
      '<div class="sub">Período analisado: ' + U.fmtDate(cx.r.ini) + ' a ' + U.fmtDate(cx.r.fim) + '</div>' +
      '<div class="sub">Filtros aplicados: ' + U.esc(filtrosTexto(state)) + '</div>' +
      '<div class="sub">Gerado em ' + U.fmtDateTime(U.nowISO()) + '</div>' +
      '</div>';

    h += '<h2>Resumo executivo</h2><div class="cards">' +
      card('Total de leads', ind.totalLeads) + card('Novos leads', ind.novos) + card('Leads em atendimento', ind.emAtendimento) +
      card('Primeira ligação', ind.primeiraLigacao) + card('Reuniões agendadas', ind.reuniaoAgendadas) + card('Reuniões realizadas', ind.reuniaoRealizadas) +
      card('Propostas', ind.qtdPropostas) + card('Fechamentos', ind.fechamentos) + card('Clientes em Boleto e Assinatura', ind.clientesBoleto) +
      card('Valor em Boleto e Assinatura', money(ind.valorBoleto)) + card('Vendas realizadas', ind.vendasRealizadas) + card('Valor vendido', money(ind.valorVendido)) +
      '</div><div class="sub" style="margin-top:6px">"Não respondeu à cadência" não possui etapa estruturada no CRM hoje — não exibido como número oficial.</div>';

    h += '<div class="pagebreak"></div><h2>Funil comercial</h2><table><tr><th>Etapa</th><th>Quantidade</th><th>%</th></tr>' +
      funil.map(function (e) { return '<tr><td>' + U.esc(e.label) + '</td><td class="num">' + e.qtd + '</td><td class="num">' + e.pct.toFixed(1) + '%</td></tr>'; }).join('') + '</table>';

    h += '<h2>Boleto e Assinatura</h2><div class="cards">' +
      card('Clientes atualmente (estado atual)', boleto.atual) + card('Valor atual (estado atual)', money(boleto.valorAtual)) +
      card('Entradas no período (evento)', boleto.entradasPeriodo) + '</div>';

    h += '<div class="pagebreak"></div><h2>Vendas</h2><div class="cards">' + card('Quantidade', vendas.qtd) + card('Valor vendido', money(vendas.valor)) + '</div>' +
      '<h3>Por consultor</h3><table><tr><th>Consultor</th><th>Vendas</th><th>Valor</th></tr>' +
      vendas.porConsultor.map(function (x) { return '<tr><td>' + U.esc(x.nome) + '</td><td class="num">' + x.qtd + '</td><td class="num">' + money(x.valor) + '</td></tr>'; }).join('') + '</table>' +
      '<h3>Por administradora</h3><table><tr><th>Administradora</th><th>Vendas</th><th>Valor</th></tr>' +
      vendas.porAdministradora.map(function (x) { return '<tr><td>' + U.esc(x.nome) + '</td><td class="num">' + x.qtd + '</td><td class="num">' + money(x.valor) + '</td></tr>'; }).join('') + '</table>' +
      '<h3>Por origem</h3><table><tr><th>Origem</th><th>Vendas</th><th>Valor</th></tr>' +
      vendas.porOrigem.map(function (x) { return '<tr><td>' + U.esc(x.nome) + '</td><td class="num">' + x.qtd + '</td><td class="num">' + money(x.valor) + '</td></tr>'; }).join('') + '</table>';

    h += '<div class="pagebreak"></div><h2>Desempenho por consultor</h2><table><tr><th>Consultor</th><th>Leads</th><th>1ª Ligação</th><th>Reuniões</th><th>Propostas</th><th>Fechamentos</th><th>Boleto</th><th>Vendas</th><th>Valor</th></tr>' +
      consultores.map(function (x) {
        return '<tr><td>' + U.esc(x.nome) + '</td><td class="num">' + x.leads + '</td><td class="num">' + x.primeiraLigacao + '</td><td class="num">' + x.reunioes +
          '</td><td class="num">' + x.propostas + '</td><td class="num">' + x.fechamentos + '</td><td class="num">' + x.boleto + '</td><td class="num">' + x.vendas + '</td><td class="num">' + money(x.valor) + '</td></tr>';
      }).join('') + '</table>';

    h += '<h2>Origens</h2><table><tr><th>Origem</th><th>Leads</th><th>Vendas</th><th>Valor</th></tr>' +
      origens.map(function (x) { return '<tr><td>' + U.esc(x.nome) + '</td><td class="num">' + x.leads + '</td><td class="num">' + x.vendas + '</td><td class="num">' + money(x.valor) + '</td></tr>'; }).join('') + '</table>';

    h += '<div class="pagebreak"></div><h2>Detalhamento dos leads (' + detalhe.length + ')</h2><table><thead><tr><th>Nome</th><th>Telefone</th><th>Consultor</th><th>Origem</th><th>Etapa</th><th>Valor</th><th>Criado em</th><th>Observações</th></tr></thead><tbody>' +
      detalhe.map(function (d) {
        return '<tr><td>' + U.esc(d.nome) + '</td><td>' + U.esc(U.fmtPhone(d.telefone)) + '</td><td>' + U.esc(d.consultor) + '</td><td>' + U.esc(d.origem || '—') +
          '</td><td>' + U.esc(d.etapa) + '</td><td class="num">' + money(d.valorCredito) + '</td><td>' + U.fmtDate(d.criadoEm) + '</td><td>' + U.esc((d.obs || '').slice(0, 80)) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="sub" style="margin-top:14px">Relatório gerado automaticamente pelo CRM Consórcio LFT. Dados restritos ao escopo de acesso do usuário que gerou este relatório.</div>';

    U.openPrint('Relatório Comercial', h);
  }

  /* ================= EXPORTAÇÃO: EXCEL .xlsx REAL (SheetJS, via CDN) =================
     Datas são exportadas como TEXTO já formatado (dd/mm/aaaa), não como data nativa do
     Excel — evita complexidade de fuso horário/serial date. Valores monetários recebem
     formato de moeda (coluna). Congelamento de cabeçalho e gráficos nativos no .xlsx NÃO
     foram implementados nesta versão (limitação da biblioteca gratuita/tempo — ver
     observações do relatório). */
  function fmtDataXLS(s) { return s ? U.fmtDate(s) : ''; }
  function aplicarMoeda(ws, linhaIni, linhaFim, col0based) {
    for (let r = linhaIni; r <= linhaFim; r++) {
      const ref = XLSX.utils.encode_cell({ r: r, c: col0based });
      if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '"R$ "#,##0.00';
    }
  }
  function aplicarPercentual(ws, linhaIni, linhaFim, col0based) {
    for (let r = linhaIni; r <= linhaFim; r++) {
      const ref = XLSX.utils.encode_cell({ r: r, c: col0based });
      if (ws[ref] && typeof ws[ref].v === 'number') { ws[ref].v = ws[ref].v / 100; ws[ref].z = '0.0%'; }
    }
  }
  function folhaComFiltro(rows) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (rows.length > 1) {
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: (rows[0] || []).length - 1 } }) };
    }
    return ws;
  }

  function exportComercialXLSX(state) {
    if (!window.XLSX) { alert('Não foi possível carregar a biblioteca de Excel. Verifique sua conexão e tente novamente.'); return; }
    const cx = comercialBase(state);
    const ind = comercialIndicadores(cx);
    const funil = comercialFunil(cx);
    const boleto = comercialBoleto(cx);
    const vendas = comercialVendas(cx);
    const consultores = comercialConsultores(cx);
    const detalhe = comercialLeadsDetalhe(cx);
    const histLinhas = comercialHistoricoLinhas(cx);
    const leadsBoletoAtual = cx.leads.filter(function (l) { return l.etapa === 'boleto_e_assinatura'; });

    const wb = XLSX.utils.book_new();

    /* 1. Resumo */
    const wsResumo = XLSX.utils.aoa_to_sheet([
      ['Relatório Comercial', Store.config().empresa || ''],
      ['Período', U.fmtDate(cx.r.ini) + ' a ' + U.fmtDate(cx.r.fim)],
      ['Gerado em', U.fmtDateTime(U.nowISO())],
      ['Filtros', filtrosTexto(state)],
      [],
      ['Indicador', 'Valor'],
      ['Total de leads', ind.totalLeads],
      ['Novos leads', ind.novos],
      ['Leads em atendimento', ind.emAtendimento],
      ['Primeira ligação', ind.primeiraLigacao],
      ['Reuniões agendadas', ind.reuniaoAgendadas],
      ['Reuniões realizadas', ind.reuniaoRealizadas],
      ['Propostas registradas', ind.qtdPropostas],
      ['Leads com proposta', ind.leadsComProposta],
      ['Fechamentos (etapa atual)', ind.fechamentos],
      ['Clientes em Boleto e Assinatura', ind.clientesBoleto],
      ['Valor em Boleto e Assinatura', ind.valorBoleto],
      ['Vendas realizadas', ind.vendasRealizadas],
      ['Valor vendido', ind.valorVendido]
    ]);
    aplicarMoeda(wsResumo, 16, 16, 1); aplicarMoeda(wsResumo, 18, 18, 1);
    wsResumo['!cols'] = [{ wch: 34 }, { wch: 26 }];
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

    /* 2. Funil */
    const funilRows = [['Etapa', 'Quantidade', 'Percentual']].concat(funil.map(function (e) { return [e.label, e.qtd, e.pct]; }));
    const wsFunil = folhaComFiltro(funilRows);
    aplicarPercentual(wsFunil, 1, funilRows.length - 1, 2);
    wsFunil['!cols'] = [{ wch: 26 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsFunil, 'Funil');

    /* 3. Leads */
    const leadsHeaders = ['ID', 'Nome', 'Telefone', 'WhatsApp', 'E-mail', 'Cidade', 'Consultor', 'Origem', 'Indicador', 'Etapa',
      'Valor Crédito', 'Qualificação', 'Criado em', 'Atualizado em', 'Próximo Contato', 'Observações', 'Reunião (data)',
      'Proposta (data)', 'Proposta (valor)', 'Venda (data)', 'Venda (valor)', 'Em Boleto e Assinatura', 'Entrada em Boleto', 'Histórico'];
    const leadsRows = [leadsHeaders].concat(detalhe.map(function (d) {
      return [d.id, d.nome, d.telefone, d.whatsapp, d.email, d.cidade, d.consultor, d.origem, d.indicador, d.etapa,
        d.valorCredito, d.qualificacao, fmtDataXLS(d.criadoEm), fmtDataXLS(d.atualizadoEm), fmtDataXLS(d.proximoContato), d.obs,
        fmtDataXLS(d.reuniaoData), fmtDataXLS(d.propostaData), d.propostaValor || '', fmtDataXLS(d.vendaData), d.vendaValor || '',
        d.emBoleto, fmtDataXLS(d.entradaBoleto), d.historicoResumo];
    }));
    const wsLeads = folhaComFiltro(leadsRows);
    aplicarMoeda(wsLeads, 1, leadsRows.length - 1, 10);
    wsLeads['!cols'] = leadsHeaders.map(function (hh) { return { wch: Math.min(Math.max(hh.length + 4, 12), 30) }; });
    XLSX.utils.book_append_sheet(wb, wsLeads, 'Leads');

    /* 4. Reuniões */
    const reunioesHeaders = ['ID', 'Lead', 'Consultor', 'Título', 'Data', 'Hora inicial', 'Hora final', 'Tipo', 'Status', 'Observações'];
    const reunioesRows = [reunioesHeaders].concat(cx.reunioes.map(function (x) {
      const l = x.leadId ? cx.leadsPorId[x.leadId] : null;
      return [x.id, l ? l.nome : '—', C.nomeUsuario(cx.consultorDe(x)), x.titulo || '', fmtDataXLS(x.data), x.horaInicio || '', x.horaFim || '', x.tipo || '', x.status || '', x.observacoes || ''];
    }));
    const wsReunioes = folhaComFiltro(reunioesRows);
    wsReunioes['!cols'] = reunioesHeaders.map(function (hh) { return { wch: Math.min(Math.max(hh.length + 4, 12), 26) }; });
    XLSX.utils.book_append_sheet(wb, wsReunioes, 'Reuniões');

    /* 5. Propostas */
    const propHeaders = ['ID', 'Lead', 'Cliente', 'Consultor', 'Valor crédito', 'Valor parcela', 'Administradora', 'Data', 'Status', 'Observações'];
    const propRows = [propHeaders].concat(cx.propostas.map(function (p) {
      const l = p.leadId ? cx.leadsPorId[p.leadId] : null;
      return [p.id, l ? l.nome : '—', p.clienteNome || '', C.nomeUsuario(p.consultorId), p.valorCredito || 0, p.valorParcela || 0, p.administradora || '', fmtDataXLS(p.data), p.status || '', p.obs || ''];
    }));
    const wsProp = folhaComFiltro(propRows);
    aplicarMoeda(wsProp, 1, propRows.length - 1, 4); aplicarMoeda(wsProp, 1, propRows.length - 1, 5);
    wsProp['!cols'] = propHeaders.map(function (hh) { return { wch: Math.min(Math.max(hh.length + 4, 12), 24) }; });
    XLSX.utils.book_append_sheet(wb, wsProp, 'Propostas');

    /* 6. Vendas */
    const vHeaders = ['ID', 'Lead', 'Cliente', 'Telefone', 'WhatsApp', 'Consultor', 'Administradora', 'Produto', 'Valor crédito', 'Valor parcela',
      'Número da cota', 'Data da venda', 'Origem', 'Indicador', 'Comissão', 'Observações', 'Status'];
    const vRows = [vHeaders].concat(cx.vendasP.map(function (v) {
      return [v.id, v.leadId || '', v.cliente || '', v.telefone || '', v.whatsapp || '', C.nomeUsuario(v.consultorId), v.administradora || '',
        v.produtoId ? C.nomeProduto(v.produtoId) : '', v.valorCredito || 0, v.valorParcela || 0, v.numeroCota || '', fmtDataXLS(v.dataVenda),
        v.origem || '', v.indicadorId ? C.nomeIndicador(v.indicadorId) : '', v.comissao || 0, v.obs || '', 'Venda Realizada'];
    }));
    const wsVendas = folhaComFiltro(vRows);
    aplicarMoeda(wsVendas, 1, vRows.length - 1, 8); aplicarMoeda(wsVendas, 1, vRows.length - 1, 9); aplicarMoeda(wsVendas, 1, vRows.length - 1, 14);
    wsVendas['!cols'] = vHeaders.map(function (hh) { return { wch: Math.min(Math.max(hh.length + 4, 12), 26) }; });
    XLSX.utils.book_append_sheet(wb, wsVendas, 'Vendas');

    /* 7. Boleto e Assinatura */
    const bHeaders = ['Lead', 'Consultor', 'Origem', 'Valor crédito', 'Data de entrada', 'Data de atualização', 'Observações'];
    const sufixoBoletoXlsx = labelEtapaBoleto();
    const entradasPorLead = {};
    cx.historico.forEach(function (h) {
      if (h.tipo === 'mudanca_etapa' && typeof h.texto === 'string' && h.texto.endsWith(sufixoBoletoXlsx) && h.data) {
        if (!entradasPorLead[h.leadId] || h.data > entradasPorLead[h.leadId]) entradasPorLead[h.leadId] = h.data;
      }
    });
    const bRows = [['Resumo', '', '', '', '', '', ''],
      ['Quantidade atual', leadsBoletoAtual.length, '', '', '', '', ''],
      ['Valor total atual', leadsBoletoAtual.reduce(function (s, l) { return s + (Number(l.valorCredito) || 0); }, 0), '', '', '', '', ''],
      ['Entradas no período', boleto.entradasPeriodo, '', '', '', '', ''],
      [], bHeaders].concat(leadsBoletoAtual.map(function (l) {
        return [l.nome, C.nomeUsuario(l.consultorId), l.origem || '', l.valorCredito || 0, fmtDataXLS(entradasPorLead[l.id]), fmtDataXLS(l.atualizadoEm), l.obs || ''];
      }));
    const wsBoleto = XLSX.utils.aoa_to_sheet(bRows);
    aplicarMoeda(wsBoleto, 1, 2, 1);
    aplicarMoeda(wsBoleto, 6, bRows.length - 1, 3);
    wsBoleto['!cols'] = bHeaders.map(function (hh) { return { wch: Math.min(Math.max(hh.length + 4, 12), 26) }; });
    XLSX.utils.book_append_sheet(wb, wsBoleto, 'Boleto e Assinatura');

    /* 8. Histórico */
    const hHeaders = ['Data', 'Lead', 'Tipo', 'Texto', 'Usuário'];
    const hRows = [hHeaders].concat(histLinhas.map(function (h) { return [U.fmtDateTime(h.data), h.lead, h.tipo, h.texto, h.usuario]; }));
    const wsHist = folhaComFiltro(hRows);
    wsHist['!cols'] = [{ wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 50 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsHist, 'Histórico');

    /* 9. Desempenho por Consultor */
    const cHeaders = ['Consultor', 'Leads', 'Primeira ligação', 'Reuniões', 'Propostas', 'Fechamentos', 'Boleto e Assinatura', 'Vendas', 'Valor vendido'];
    const cRows = [cHeaders].concat(consultores.map(function (x) {
      return [x.nome, x.leads, x.primeiraLigacao, x.reunioes, x.propostas, x.fechamentos, x.boleto, x.vendas, x.valor];
    }));
    const wsCons = folhaComFiltro(cRows);
    aplicarMoeda(wsCons, 1, cRows.length - 1, 8);
    wsCons['!cols'] = cHeaders.map(function (hh) { return { wch: Math.min(Math.max(hh.length + 4, 12), 22) }; });
    XLSX.utils.book_append_sheet(wb, wsCons, 'Desempenho Consultor');

    XLSX.writeFile(wb, 'relatorio-comercial-' + U.todayISO() + '.xlsx');
    C.toast('Excel (.xlsx) gerado com 9 abas.');
  }

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
