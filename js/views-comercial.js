/* Simulações, Propostas e Vendas (listas globais) */
(function () {
  function fval(b, n) { const e = b.querySelector('[name="' + n + '"]'); return e ? String(e.value).trim() : ''; }
  function fnum(b, n) { return U.parseNumber(fval(b, n)); }
  function buildForm(html) { return U.el('<div class="form-grid">' + html + '</div>'); }
  function admOpts(sel) { return C.opts(Store.config().administradoras, sel, { blank: '—' }); }
  function prodOpts(sel) {
    return C.opts(Store.all('produtos').filter(function (p) { return p.ativo; }).map(function (p) { return { value: p.id, label: p.nome }; }), sel, { blank: '—' });
  }
  function scopedLeads() { return Auth.scope(Store.all('leads')); }
  function leadOpts(sel) {
    return C.opts(scopedLeads().map(function (l) { return { value: l.id, label: l.nome + ' (' + Store.etapaLabel(l.etapa) + ')' }; }), sel, { blank: '— selecione o lead —' });
  }

  /* ================= SIMULAÇÕES ================= */
  Views.simulacoes = function (container) {
    const head = U.el('<div class="page-head"><h1 class="page-title">Simulações</h1></div>');
    if (Auth.canEdit()) {
      const add = U.el('<button class="btn primary">+ Nova simulação</button>');
      add.onclick = function () {
        const b = buildForm(C.field('Lead / cliente', '<select name="lead">' + leadOpts('') + '</select>', true));
        C.modal('Nova simulação — escolher lead', b, {
          saveLabel: 'Continuar', onSave: function () {
            const l = Store.get('leads', fval(b, 'lead'));
            if (!l) { alert('Selecione um lead.'); return false; }
            Views._lead.simForm(l);
          }
        });
      };
      head.appendChild(add);
    }
    container.appendChild(head);

    const f = U.el('<div class="filters">' +
      '<select id="f-cons"><option value="">Consultor: todos</option>' + C.opts(C.usuariosConsultores(), '') + '</select>' +
      '<select id="f-adm"><option value="">Administradora: todas</option>' + C.opts(Store.config().administradoras, '') + '</select>' +
      '</div>');
    container.appendChild(f);
    const wrap = U.el('<div class="card table-wrap"></div>');
    container.appendChild(wrap);

    function draw() {
      const fc = f.querySelector('#f-cons').value, fa = f.querySelector('#f-adm').value;
      const leadIds = scopedLeads().reduce(function (m, l) { m[l.id] = l; return m; }, {});
      const rows = Store.all('simulacoes').filter(function (s) {
        if (!leadIds[s.leadId]) return false;
        if (fc && s.consultorId !== fc) return false;
        if (fa && s.administradora !== fa) return false;
        return true;
      }).sort(function (a, b) { return (b.criadoEm || '') < (a.criadoEm || '') ? -1 : 1; });

      wrap.innerHTML = '<table class="table"><thead><tr><th>Data</th><th>Cliente</th><th>Consultor</th>' +
        '<th class="num">Crédito</th><th class="num">Parcela</th><th>Parcelas</th><th>Administradora</th><th>Grupo/Cota</th></tr></thead><tbody>' +
        rows.map(function (s) {
          const l = leadIds[s.leadId];
          return '<tr data-lead="' + s.leadId + '"><td>' + U.fmtDate(s.criadoEm) + '</td><td>' + U.esc(l ? l.nome : '—') + '</td>' +
            '<td>' + U.esc(C.nomeUsuario(s.consultorId)) + '</td><td class="num">' + U.brl(s.valorCredito) + '</td>' +
            '<td class="num">' + U.brl(s.valorParcela) + '</td><td>' + (s.parcelas || '—') + '</td>' +
            '<td>' + U.esc(s.administradora || '—') + '</td><td>' + U.esc((s.grupo || '—') + ' / ' + (s.cota || '—')) + '</td></tr>';
        }).join('') + '</tbody></table>' + (rows.length ? '' : '<div class="empty">Nenhuma simulação.</div>');
      wrap.querySelectorAll('tr[data-lead]').forEach(function (tr) {
        tr.onclick = function () { Views._lead.openModal(tr.dataset.lead); };
      });
    }
    f.querySelectorAll('select').forEach(function (e) { e.onchange = draw; });
    draw();
  };

  /* ================= PROPOSTAS ================= */
  Views.propostas = function (container) {
    const head = U.el('<div class="page-head"><h1 class="page-title">Propostas</h1></div>');
    if (Auth.canEdit()) {
      const add = U.el('<button class="btn primary">+ Nova proposta</button>');
      add.onclick = function () {
        const b = buildForm(C.field('Lead / cliente', '<select name="lead">' + leadOpts('') + '</select>', true));
        C.modal('Nova proposta — escolher lead', b, {
          saveLabel: 'Continuar', onSave: function () {
            const l = Store.get('leads', fval(b, 'lead'));
            if (!l) { alert('Selecione um lead.'); return false; }
            Views._lead.propostaForm(l);
          }
        });
      };
      head.appendChild(add);
    }
    container.appendChild(head);

    const L = Store.constants().LABEL_PROPOSTA;
    const f = U.el('<div class="filters">' +
      '<select id="f-st"><option value="">Status: todos</option>' +
      C.opts(Store.constants().STATUS_PROPOSTA.map(function (s) { return { value: s, label: L[s] }; }), '') + '</select>' +
      '<select id="f-cons"><option value="">Consultor: todos</option>' + C.opts(C.usuariosConsultores(), '') + '</select>' +
      '<select id="f-adm"><option value="">Administradora: todas</option>' + C.opts(Store.config().administradoras, '') + '</select>' +
      '</div>');
    container.appendChild(f);
    const wrap = U.el('<div class="card table-wrap"></div>');
    container.appendChild(wrap);

    function draw() {
      const fs = f.querySelector('#f-st').value, fc = f.querySelector('#f-cons').value, fa = f.querySelector('#f-adm').value;
      const leadIds = scopedLeads().reduce(function (m, l) { m[l.id] = true; return m; }, {});
      const rows = Store.all('propostas').filter(function (p) {
        if (!Auth.canSeeAll() && !leadIds[p.leadId] && p.consultorId !== Auth.currentId()) return false;
        if (fs && p.status !== fs) return false;
        if (fc && p.consultorId !== fc) return false;
        if (fa && p.administradora !== fa) return false;
        return true;
      }).sort(function (a, b) { return (b.data || b.criadoEm || '') < (a.data || a.criadoEm || '') ? -1 : 1; });

      wrap.innerHTML = '<table class="table"><thead><tr><th>Data</th><th>Cliente</th><th>Consultor</th>' +
        '<th class="num">Crédito</th><th class="num">Parcela</th><th>Administradora</th><th>Status</th></tr></thead><tbody>' +
        rows.map(function (p) {
          return '<tr data-lead="' + p.leadId + '"><td>' + U.fmtDate(p.data) + '</td><td>' + U.esc(p.clienteNome || '—') + '</td>' +
            '<td>' + U.esc(C.nomeUsuario(p.consultorId)) + '</td><td class="num">' + U.brl(p.valorCredito) + '</td>' +
            '<td class="num">' + U.brl(p.valorParcela) + '</td><td>' + U.esc(p.administradora || '—') + '</td>' +
            '<td>' + C.chip(L[p.status] || p.status) + '</td></tr>';
        }).join('') + '</tbody></table>' + (rows.length ? '' : '<div class="empty">Nenhuma proposta.</div>');
      wrap.querySelectorAll('tr[data-lead]').forEach(function (tr) {
        tr.onclick = function () { if (tr.dataset.lead) Views._lead.openModal(tr.dataset.lead); };
      });
    }
    f.querySelectorAll('select').forEach(function (e) { e.onchange = draw; });
    draw();
  };

  /* ================= VENDAS ================= */
  function vendaForm(venda, after) {
    const isNew = !venda;
    venda = venda || { dataVenda: U.todayISO(), status: 'venda_realizada' };
    const b = buildForm(
      C.field('Cliente', '<input name="cliente" value="' + U.esc(venda.cliente || '') + '">', true) +
      C.field('Telefone', '<input name="tel" value="' + U.esc(venda.telefone || '') + '">') +
      C.field('WhatsApp', '<input name="wpp" value="' + U.esc(venda.whatsapp || '') + '">') +
      C.field('Consultor', '<select name="cons">' + C.opts(C.usuariosConsultores(), venda.consultorId || (Auth.isConsultor() ? Auth.currentId() : '')) + '</select>') +
      C.field('Administradora', '<select name="adm">' + admOpts(venda.administradora || '') + '</select>') +
      C.field('Produto', '<select name="prod">' + prodOpts(venda.produtoId || '') + '</select>') +
      C.field('Valor do crédito (R$)', '<input name="cred" inputmode="decimal" value="' + (venda.valorCredito || '') + '">') +
      C.field('Valor da parcela (R$)', '<input name="parc" inputmode="decimal" value="' + (venda.valorParcela || '') + '">') +
      C.field('Número da cota', '<input name="cota" value="' + U.esc(venda.numeroCota || '') + '">') +
      C.field('Data da venda', '<input type="date" name="data" value="' + (venda.dataVenda || U.todayISO()) + '">') +
      C.field('Origem', '<select name="origem">' + C.opts(Store.config().origens, venda.origem || '', { blank: '—' }) + '</select>') +
      C.field('Comissão (R$)', '<input name="com" inputmode="decimal" value="' + (venda.comissao || '') + '">') +
      C.field('Observações', '<textarea name="obs">' + U.esc(venda.obs || '') + '</textarea>', true)
    );
    const indRow = U.el('<div class="field full" style="display:none"><span>Pessoa que indicou</span>' +
      '<select name="ind">' + C.opts(Store.all('indicadores').map(function (i) { return { value: i.id, label: i.nome }; }), venda.indicadorId || '', { blank: '—' }) + '</select></div>');
    b.appendChild(indRow);
    function syncInd() { indRow.style.display = b.querySelector('[name="origem"]').value === 'Indicação' ? 'flex' : 'none'; }
    b.querySelector('[name="origem"]').addEventListener('change', syncInd); syncInd();

    C.modal(isNew ? 'Nova venda' : 'Editar venda', b, {
      saveLabel: 'Salvar', onSave: function () {
        const cred = fnum(b, 'cred');
        if (!fval(b, 'cliente')) { alert('Informe o cliente.'); return false; }
        if (!cred) { alert('Informe o valor do crédito.'); return false; }
        const rec = {
          cliente: fval(b, 'cliente'), telefone: fval(b, 'tel'), whatsapp: fval(b, 'wpp'),
          consultorId: fval(b, 'cons') || null, administradora: fval(b, 'adm'), produtoId: fval(b, 'prod') || null,
          valorCredito: cred, valorParcela: fnum(b, 'parc'), numeroCota: fval(b, 'cota'),
          dataVenda: fval(b, 'data'), origem: fval(b, 'origem'),
          indicadorId: fval(b, 'origem') === 'Indicação' ? (fval(b, 'ind') || null) : null,
          comissao: fnum(b, 'com'), obs: fval(b, 'obs'), status: 'venda_realizada'
        };
        rec.metaId = C.metaParaVenda(Object.assign({}, venda, rec));
        if (isNew) Store.insert('vendas', rec); else Store.update('vendas', venda.id, rec);
        C.toast('Venda salva. Dashboard, relatórios e metas atualizados.');
        if (after) after();
      }
    });
  }
  Views._vendaForm = vendaForm;

  Views.vendas = function (container) {
    const head = U.el('<div class="page-head"><h1 class="page-title">Vendas</h1></div>');
    if (Auth.canEdit()) {
      const add = U.el('<button class="btn primary">+ Nova venda</button>');
      add.onclick = function () { vendaForm(null); };
      head.appendChild(add);
    }
    container.appendChild(head);

    const f = U.el('<div class="filters">' +
      '<select id="f-cons"><option value="">Consultor: todos</option>' + C.opts(C.usuariosConsultores(), '') + '</select>' +
      '<select id="f-adm"><option value="">Administradora: todas</option>' + C.opts(Store.config().administradoras, '') + '</select>' +
      '<select id="f-origem"><option value="">Origem: todas</option>' + C.opts(Store.config().origens, '') + '</select>' +
      '<select id="f-ind"><option value="">Indicado por: todos</option>' + C.opts(Store.all('indicadores').map(function (i) { return { value: i.id, label: i.nome }; }), '') + '</select>' +
      '<input id="f-de" type="date" title="De"><input id="f-ate" type="date" title="Até">' +
      '<input id="f-min" inputmode="decimal" placeholder="Valor mín."><input id="f-max" inputmode="decimal" placeholder="Valor máx.">' +
      '</div>');
    container.appendChild(f);
    const wrap = U.el('<div class="card table-wrap"></div>');
    container.appendChild(wrap);

    function draw() {
      const fc = f.querySelector('#f-cons').value, fa = f.querySelector('#f-adm').value,
        fo = f.querySelector('#f-origem').value, fi = f.querySelector('#f-ind').value,
        fde = f.querySelector('#f-de').value, fate = f.querySelector('#f-ate').value,
        fmin = U.parseNumber(f.querySelector('#f-min').value), fmax = U.parseNumber(f.querySelector('#f-max').value);

      const rows = Auth.scope(Store.all('vendas')).filter(function (v) {
        if (fc && v.consultorId !== fc) return false;
        if (fa && v.administradora !== fa) return false;
        if (fo && v.origem !== fo) return false;
        if (fi && v.indicadorId !== fi) return false;
        if (fde && v.dataVenda < fde) return false;
        if (fate && v.dataVenda > fate) return false;
        if (fmin && (v.valorCredito || 0) < fmin) return false;
        if (fmax && (v.valorCredito || 0) > fmax) return false;
        return true;
      }).sort(function (a, b) { return (b.dataVenda || '') < (a.dataVenda || '') ? -1 : 1; });

      const total = rows.reduce(function (s, v) { return s + (Number(v.valorCredito) || 0); }, 0);

      wrap.innerHTML = '<table class="table"><thead><tr><th>Data</th><th>Cliente</th><th>Telefone</th><th>Consultor</th>' +
        '<th>Administradora</th><th class="num">Crédito</th><th class="num">Parcela</th><th>Cota</th><th>Origem</th><th>Indicado por</th><th></th></tr></thead><tbody>' +
        rows.map(function (v) {
          return '<tr data-id="' + v.id + '"><td>' + U.fmtDate(v.dataVenda) + '</td><td>' + U.esc(v.cliente) + '</td>' +
            '<td>' + U.esc(U.fmtPhone(v.telefone)) + '</td><td>' + U.esc(C.nomeUsuario(v.consultorId)) + '</td>' +
            '<td>' + U.esc(v.administradora || '—') + '</td><td class="num">' + U.brl(v.valorCredito) + '</td>' +
            '<td class="num">' + U.brl(v.valorParcela) + '</td><td>' + U.esc(v.numeroCota || '—') + '</td>' +
            '<td>' + U.esc(v.origem || '—') + '</td><td>' + (v.indicadorId ? U.esc(C.nomeIndicador(v.indicadorId)) : '—') + '</td>' +
            '<td class="row-actions">' + (Auth.canEdit() ? '<button class="iconbtn edit">✏️</button><button class="iconbtn del">🗑️</button>' : '') + '</td></tr>';
        }).join('') +
        '</tbody><tfoot><tr><td colspan="5">Total de créditos</td><td class="num">' + U.brl(total) + '</td><td colspan="5"></td></tr></tfoot></table>' +
        (rows.length ? '' : '<div class="empty">Nenhuma venda encontrada.</div>');

      wrap.querySelectorAll('tr[data-id]').forEach(function (tr) {
        const v = Store.get('vendas', tr.dataset.id);
        const e = tr.querySelector('.edit'), d = tr.querySelector('.del');
        if (e) e.onclick = function (ev) { ev.stopPropagation(); vendaForm(v); };
        if (d) d.onclick = function (ev) {
          ev.stopPropagation();
          C.confirm('Excluir esta venda? (o histórico do lead é mantido)', function () {
            Store.batch(function () {
              if (v.leadId) { const l = Store.get('leads', v.leadId); if (l && l.vendaId === v.id) Store.update('leads', l.id, { vendaId: null }); }
              Store.remove('vendas', v.id);
            });
          });
        };
      });
    }
    f.querySelectorAll('select,input').forEach(function (e) { e.addEventListener('change', draw); e.addEventListener('keyup', draw); });
    draw();
  };
})();
