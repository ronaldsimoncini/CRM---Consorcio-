/* Metas — objetivo financeiro por período (separado da Dashboard) */
(function () {
  function fval(b, n) { const e = b.querySelector('[name="' + n + '"]'); return e ? String(e.value).trim() : ''; }
  function buildForm(html) { return U.el('<div class="form-grid">' + html + '</div>'); }
  const S = C.META_STATUS;

  function subStat(label, value, cls) {
    return '<div><span>' + label + '</span><b' + (cls ? ' class="' + cls + '"' : '') + '>' + value + '</b></div>';
  }

  function metasVisiveis() {
    const all = Store.all('metas');
    if (Auth.canSeeAll()) return all;
    /* meta de equipe é de todos; meta individual segue o dono (owner_uid, com fallback consultorId) */
    return all.filter(function (m) { return m.tipo === 'equipe' || Auth.owns(m); });
  }

  function metaForm(meta) {
    const isNew = !meta;
    meta = meta || { nome: '', tipo: 'equipe', valorMeta: '', dataInicio: U.todayISO(), dataFim: '', produtoId: null, consultorId: null, responsavel: '', obs: '', statusManual: null };
    const produtos = Store.all('produtos').filter(function (p) { return p.ativo; }).map(function (p) { return { value: p.id, label: p.nome }; });

    const b = buildForm(
      C.field('Nome da meta', '<input name="nome" value="' + U.esc(meta.nome) + '">', true) +
      C.field('Tipo', '<select name="tipo"><option value="equipe"' + (meta.tipo === 'equipe' ? ' selected' : '') + '>Equipe</option>' +
        '<option value="individual"' + (meta.tipo === 'individual' ? ' selected' : '') + '>Individual</option></select>') +
      C.field('Consultor (meta individual)', '<select name="cons">' + C.opts(C.usuariosConsultores(), meta.consultorId, { blank: '—' }) + '</select>') +
      C.field('Valor total da meta (R$)', '<input name="valor" inputmode="decimal" value="' + meta.valorMeta + '">') +
      C.field('Data inicial', '<input type="date" name="ini" value="' + (meta.dataInicio || '') + '">') +
      C.field('Data final', '<input type="date" name="fim" value="' + (meta.dataFim || '') + '">') +
      C.field('Produto', '<select name="prod">' + C.opts(produtos, meta.produtoId, { blank: 'Todos os produtos (meta geral)' }) + '</select>') +
      C.field('Responsável', '<input name="resp" value="' + U.esc(meta.responsavel || '') + '">') +
      C.field('Observações', '<textarea name="obs">' + U.esc(meta.obs || '') + '</textarea>', true)
    );

    C.modal(isNew ? 'Nova meta' : 'Editar meta', b, {
      saveLabel: 'Salvar', onSave: function () {
        const rec = {
          nome: fval(b, 'nome'), tipo: fval(b, 'tipo'),
          consultorId: fval(b, 'tipo') === 'individual' ? (fval(b, 'cons') || null) : null,
          valorMeta: U.parseNumber(fval(b, 'valor')),
          dataInicio: fval(b, 'ini'), dataFim: fval(b, 'fim'),
          produtoId: fval(b, 'prod') || null, responsavel: fval(b, 'resp'), obs: fval(b, 'obs')
        };
        if (!rec.nome) { alert('Informe o nome da meta.'); return false; }
        if (!rec.valorMeta || rec.valorMeta <= 0) { alert('Informe um valor de meta válido.'); return false; }
        if (!rec.dataInicio || !rec.dataFim) { alert('Informe as datas inicial e final.'); return false; }
        if (rec.dataFim < rec.dataInicio) { alert('A data final deve ser posterior à inicial.'); return false; }
        if (rec.tipo === 'individual' && !rec.consultorId) { alert('Selecione o consultor da meta individual.'); return false; }
        /* Fase 2: meta individual pertence ao consultor (owner_uid); meta de equipe fica sem dono
           (visível a todos no RLS da Fase 3). Só grava owner_uid quando o consultor já tem login. */
        if (rec.tipo === 'individual' && Store.ownerUidFor) {
          const ou = Store.ownerUidFor(rec.consultorId);
          if (ou) rec.owner_uid = ou;
        }
        Store.batch(function () {
          if (isNew) Store.insert('metas', rec); else Store.update('metas', meta.id, rec);
          /* vincula automaticamente as vendas que ainda não têm meta e se encaixam nesta */
          Store.all('vendas').filter(function (v) { return v.status === 'venda_realizada' && !v.metaId; })
            .forEach(function (v) { const mid = C.metaParaVenda(v); if (mid) Store.update('vendas', v.id, { metaId: mid }); });
        });
        C.toast('Meta salva.');
      }
    });
  }

  Views.metas = function (container) {
    const head = U.el('<div class="page-head"><h1 class="page-title">Metas</h1><div class="head-btns"></div></div>');
    const hb = head.querySelector('.head-btns');
    if (Auth.canSeeAll()) {
      const tv = U.el('<button class="btn ghost">📺 Painel TV</button>');
      tv.onclick = function () {
        const tks = Store.config().painelTokens || [];
        const url = new URL('painel-tv.html' + (tks.length ? '?tv=' + encodeURIComponent(tks[0].token) : ''), location.href).href;
        window.open(url, '_blank');
      };
      hb.appendChild(tv);
    }
    if (Auth.isAdmin()) {
      const add = U.el('<button class="btn primary">+ Nova meta</button>');
      add.onclick = function () { metaForm(null); };
      hb.appendChild(add);
    }
    container.appendChild(head);
    container.appendChild(U.el('<div class="muted">A meta é um objetivo financeiro por período. Toda venda registrada em <b>Fechamento</b> que se encaixa numa meta ativa entra automaticamente no progresso.</div>'));

    const list = metasVisiveis().sort(function (a, b) { return (b.criadoEm || '') < (a.criadoEm || '') ? -1 : 1; });
    if (!list.length) { container.appendChild(U.el('<div class="card empty">Nenhuma meta cadastrada.</div>')); return; }

    list.forEach(function (meta) {
      const c = C.computeMeta(meta);
      const card = U.el('<div class="card meta-row' + (c.status === 'atingida' ? ' is-won' : '') + '"></div>');
      card.innerHTML =
        '<div class="meta-row-head"><div>' +
        '<b>' + U.esc(meta.nome) + '</b> ' + C.chip(S[c.status].label, S[c.status].cls) + ' ' +
        C.chip(meta.tipo === 'individual' ? 'Individual · ' + C.nomeUsuario(meta.consultorId) : 'Equipe', 'st-muted') +
        '</div><div class="meta-row-actions"></div></div>' +
        (c.status === 'atingida' ? '<div class="won-banner">🎉 META ATINGIDA! ' + c.percentual.toFixed(0) + '% da meta' +
          (c.excedente > 0 ? ' — excedente de ' + U.brl(c.excedente) : '') + '</div>' : '') +
        '<div class="meta-triple">' +
        '<div><span>META</span><b>' + U.brl(c.valorMeta) + '</b></div>' +
        '<div><span>VENDIDO</span><b class="v">' + U.brl(c.vendido) + '</b></div>' +
        '<div><span>RESTANTE</span><b class="r">' + U.brl(c.restante) + '</b></div>' +
        '</div>' +
        '<div class="meta-pct">' + c.percentual.toFixed(1) + '% da meta</div>' +
        C.progressBar(c.percentual) +
        '<div class="meta-substats">' +
        subStat('Período', U.fmtDate(meta.dataInicio) + ' – ' + U.fmtDate(meta.dataFim)) +
        subStat('Dias restantes', String(c.diasRestantes)) +
        subStat('Média necessária / dia', U.brl(c.mediaNecessariaDia)) +
        subStat('Ritmo atual / dia', U.brl(c.ritmoDia)) +
        subStat('No ritmo?', c.noRitmo ? 'Sim ✅' : 'Não ⚠️', c.noRitmo ? 'ok' : 'bad') +
        subStat('Projeção de conclusão', c.dataProjecao ? c.dataProjecao.toLocaleDateString('pt-BR') : '—') +
        subStat('Produto', meta.produtoId ? C.nomeProduto(meta.produtoId) : 'Todos') +
        subStat('Nº de vendas', String(c.qtd)) +
        subStat('Responsável', U.esc(meta.responsavel || '—')) +
        '</div>' +
        (meta.obs ? '<div class="muted">Obs: ' + U.esc(meta.obs) + '</div>' : '');

      if (Auth.isAdmin()) {
        const acts = card.querySelector('.meta-row-actions');
        const edit = U.el('<button class="iconbtn" title="Editar">✏️</button>');
        edit.onclick = function () { metaForm(meta); };
        const enc = U.el('<button class="iconbtn" title="' + (meta.statusManual === 'encerrada' ? 'Reabrir' : 'Encerrar') + '">' + (meta.statusManual === 'encerrada' ? '↩️' : '🔒') + '</button>');
        enc.onclick = function () { Store.update('metas', meta.id, { statusManual: meta.statusManual === 'encerrada' ? null : 'encerrada' }); };
        const del = U.el('<button class="iconbtn" title="Excluir">🗑️</button>');
        del.onclick = function () {
          C.confirm('Excluir a meta "' + meta.nome + '"? As vendas ligadas a ela ficam sem meta.', function () {
            Store.batch(function () {
              Store.all('vendas').filter(function (v) { return v.metaId === meta.id; })
                .forEach(function (v) { Store.update('vendas', v.id, { metaId: null }); });
              Store.remove('metas', meta.id);
            });
          });
        };
        acts.append(edit, enc, del);
      }
      container.appendChild(card);
    });
  };
})();
