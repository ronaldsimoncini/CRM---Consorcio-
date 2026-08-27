/* Componentes de UI compartilhados + cálculos de meta */
window.Views = window.Views || {};
window.C = (function () {

  /* ---------- lookups ---------- */
  function nomeUsuario(id) {
    const u = Store.get('usuarios', id);
    return u ? u.nome : (id ? '(removido)' : '—');
  }
  function nomeIndicador(id) { const i = Store.get('indicadores', id); return i ? i.nome : '—'; }
  function nomeProduto(id) { const p = Store.get('produtos', id); return p ? p.nome : '—'; }
  function nomeMeta(id) { const m = Store.get('metas', id); return m ? m.nome : '—'; }

  /* ---------- modal ---------- */
  function modal(title, bodyEl, opts) {
    opts = opts || {};
    const root = document.getElementById('modal-root');
    const wrap = U.el(
      '<div class="modal-backdrop"><div class="modal' + (opts.wide ? ' wide' : '') + '">' +
      '<div class="modal-head"><h3></h3><button class="iconbtn x" aria-label="Fechar">✕</button></div>' +
      '<div class="modal-body"></div>' +
      '<div class="modal-foot"></div>' +
      '</div></div>'
    );
    wrap.querySelector('h3').textContent = title;
    wrap.querySelector('.modal-body').appendChild(bodyEl);
    const foot = wrap.querySelector('.modal-foot');
    const close = function () { wrap.remove(); };

    if (opts.onSave) {
      const cancel = U.el('<button class="btn ghost">' + (opts.cancelLabel || 'Cancelar') + '</button>');
      cancel.onclick = close;
      const save = U.el('<button class="btn primary">' + (opts.saveLabel || 'Salvar') + '</button>');
      save.onclick = function () { if (opts.onSave() !== false) close(); };
      foot.append(cancel, save);
    } else {
      const ok = U.el('<button class="btn ghost">Fechar</button>');
      ok.onclick = close;
      foot.appendChild(ok);
    }
    (opts.extraButtons || []).forEach(function (b) { foot.insertBefore(b, foot.firstChild); });

    wrap.querySelector('.x').onclick = close;
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
    root.appendChild(wrap);
    return { close: close, wrap: wrap };
  }

  function confirm(msg, onYes) {
    modal('Confirmar', U.el('<div><p>' + U.esc(msg) + '</p></div>'), {
      saveLabel: 'Confirmar', onSave: function () { onYes(); }
    });
  }

  function toast(msg) {
    const root = document.getElementById('toast-root');
    const t = U.el('<div class="toast">' + U.esc(msg) + '</div>');
    root.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 2600);
  }

  /* ---------- helpers de formulário ---------- */
  function field(label, inner, full) {
    return '<label class="field' + (full ? ' full' : '') + '"><span>' + label + '</span>' + inner + '</label>';
  }
  function opts(items, selected, cfg) {
    cfg = cfg || {};
    let o = cfg.blank != null ? '<option value="">' + cfg.blank + '</option>' : '';
    o += items.map(function (it) {
      const val = typeof it === 'string' ? it : it.value;
      const lab = typeof it === 'string' ? it : it.label;
      return '<option value="' + U.esc(val) + '"' + (String(val) === String(selected) ? ' selected' : '') + '>' + U.esc(lab) + '</option>';
    }).join('');
    return o;
  }
  function usuariosConsultores() {
    return Store.all('usuarios').filter(function (u) {
      return (u.nivel === 'consultor' || u.nivel === 'gestor' || u.nivel === 'admin') && u.status === 'ativo';
    }).map(function (u) { return { value: u.id, label: u.nome }; });
  }

  /* ---------- blocos visuais ---------- */
  function kpi(label, value, sub) {
    return '<div class="card kpi"><div class="kpi-val">' + value + '</div><div class="kpi-label">' + label + '</div>' +
      (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>';
  }
  function chip(text, cls) { return '<span class="chip ' + (cls || '') + '">' + U.esc(text) + '</span>'; }

  function progressBar(percent) {
    const p = U.clamp(percent, 0, 100);
    return '<div class="progress"><div class="progress-track">' +
      '<div class="progress-fill" style="width:' + p + '%"></div>' +
      '<div class="progress-marker" style="left:' + p + '%"></div></div>' +
      '<div class="progress-scale"><span>R$ 0</span><span>' + percent.toFixed(0) + '% concluído</span><span>Meta</span></div></div>';
  }

  /* gráfico de barras simples (valor) com contagem no topo */
  function barChart(items, cfg) {
    cfg = cfg || {};
    if (!items.length) return '<div class="empty">Sem dados no período.</div>';
    const n = items.length;
    const w = Math.max(n * 56, 320), h = 200, padL = 6, padB = 26, padT = 18;
    const max = Math.max(1, Math.max.apply(null, items.map(function (i) { return i.valor || 0; })));
    const slot = (w - padL) / n;
    const bw = Math.min(42, slot - 12);
    let bars = '';
    items.forEach(function (it, idx) {
      const x = padL + idx * slot + (slot - bw) / 2;
      const bh = (h - padB - padT) * ((it.valor || 0) / max);
      const y = h - padB - bh;
      bars += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(bh, 2).toFixed(1) + '" rx="4" fill="var(--brand)"></rect>';
      if (it.qtd != null) bars += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle" font-size="10" fill="#5A6472">' + it.qtd + '</text>';
      bars += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (h - padB + 13) + '" text-anchor="middle" font-size="9" fill="#5A6472">' + U.esc(String(it.label).slice(0, 9)) + '</text>';
    });
    return '<div class="chart-wrap"><svg viewBox="0 0 ' + w + ' ' + h + '" class="chart" preserveAspectRatio="xMidYMid meet">' +
      '<line x1="' + padL + '" y1="' + (h - padB) + '" x2="' + w + '" y2="' + (h - padB) + '" stroke="#E5E8EE"></line>' + bars + '</svg></div>';
  }

  /* barras horizontais (ex.: origem dos leads) */
  function hBars(items) {
    if (!items.length) return '<div class="empty">Sem dados.</div>';
    const max = Math.max(1, Math.max.apply(null, items.map(function (i) { return i.valor; })));
    return '<div class="hbars">' + items.map(function (it) {
      return '<div class="hbar"><span class="hbar-lb">' + U.esc(it.label) + '</span>' +
        '<span class="hbar-tr"><span class="hbar-fl" style="width:' + (it.valor / max * 100).toFixed(1) + '%"></span></span>' +
        '<span class="hbar-vl">' + (it.fmt || it.valor) + '</span></div>';
    }).join('') + '</div>';
  }

  const _tabMem = {};
  function tabs(container, items, onSelect, memId) {
    const bar = U.el('<div class="tabbar"></div>');
    const keys = items.map(function (i) { return i.key; });
    let active = (memId && keys.indexOf(_tabMem[memId]) >= 0) ? _tabMem[memId] : items[0].key;
    items.forEach(function (it) {
      const b = U.el('<button class="tabbtn">' + U.esc(it.label) + '</button>');
      if (it.key === active) b.classList.add('active');
      b.onclick = function () {
        bar.querySelectorAll('.tabbtn').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        active = it.key;
        if (memId) _tabMem[memId] = it.key;
        onSelect(it.key);
      };
      bar.appendChild(b);
    });
    container.appendChild(bar);
    onSelect(active);
  }

  /* ================= CÁLCULO DA META =================
     Modelo: a meta é um VALOR TOTAL a alcançar. Cada venda ligada à meta
     abate do valor restante automaticamente.
       META      = valor objetivo (não muda)
       VENDIDO   = soma das vendas ligadas à meta
       RESTANTE  = META - VENDIDO  (nunca abaixo de zero)               */
  function computeMeta(meta) {
    const vendas = Store.all('vendas').filter(function (v) {
      return v.metaId === meta.id && v.status === 'venda_realizada';
    });
    const vendido = vendas.reduce(function (s, v) { return s + (Number(v.valorCredito) || 0); }, 0);
    const qtd = vendas.length;
    const valorMeta = Number(meta.valorMeta) || 0;
    const percentual = U.pct(vendido, valorMeta);
    const restante = Math.max(valorMeta - vendido, 0);
    const excedente = Math.max(vendido - valorMeta, 0);

    const hoje = U.dateFromISO(U.todayISO());
    const ini = U.dateFromISO(meta.dataInicio);
    const fim = U.dateFromISO(meta.dataFim);
    const diasTotais = Math.max(U.daysBetween(ini, fim) + 1, 1);
    const diasDecorridos = U.clamp(U.daysBetween(ini, hoje) + 1, 1, diasTotais);
    const diasRestantes = Math.max(U.daysBetween(hoje, fim), 0);

    const ritmoDia = vendido / diasDecorridos;
    const mediaNecessariaDia = diasRestantes > 0 ? restante / diasRestantes : restante;
    let dataProjecao = null;
    if (ritmoDia > 0 && restante > 0) dataProjecao = U.addDays(hoje, Math.ceil(restante / ritmoDia));
    const noRitmo = vendido >= valorMeta || ritmoDia >= mediaNecessariaDia;

    let status;
    if (meta.statusManual === 'encerrada') status = 'encerrada';
    else if (vendido >= valorMeta) status = 'atingida';
    else if (hoje > fim) status = 'nao_atingida';
    else status = 'em_andamento';

    return {
      vendido: vendido, realizado: vendido, qtd: qtd, valorMeta: valorMeta, percentual: percentual,
      restante: restante, falta: restante, excedente: excedente,
      diasTotais: diasTotais, diasDecorridos: diasDecorridos, diasRestantes: diasRestantes,
      ritmoDia: ritmoDia, mediaNecessariaDia: mediaNecessariaDia, dataProjecao: dataProjecao,
      noRitmo: noRitmo, status: status, vendas: vendas
    };
  }

  /* Escolhe a ÚNICA meta ativa mais específica para uma venda (automático) */
  function metaParaVenda(v) {
    const cands = Store.all('metas').filter(function (m) {
      if (m.statusManual === 'encerrada') return false;
      if (m.dataFim && v.dataVenda && v.dataVenda > m.dataFim) return false; /* meta já terminada */
      if (m.produtoId && m.produtoId !== v.produtoId) return false;
      if (m.tipo === 'individual' && m.consultorId !== v.consultorId) return false;
      return true;
    });
    if (!cands.length) return null;
    const score = function (m) { return (m.tipo === 'individual' ? 2 : 0) + (m.produtoId ? 1 : 0); };
    cands.sort(function (a, b) { return score(b) - score(a) || (a.dataFim < b.dataFim ? -1 : 1); });
    return cands[0].id;
  }

  const META_STATUS = {
    em_andamento: { label: 'Em andamento', cls: 'st-info' },
    atingida: { label: 'Atingida', cls: 'st-ok' },
    encerrada: { label: 'Encerrada', cls: 'st-muted' },
    nao_atingida: { label: 'Não atingida', cls: 'st-bad' }
  };

  return {
    nomeUsuario: nomeUsuario, nomeIndicador: nomeIndicador, nomeProduto: nomeProduto, nomeMeta: nomeMeta,
    modal: modal, confirm: confirm, toast: toast, field: field, opts: opts, usuariosConsultores: usuariosConsultores,
    kpi: kpi, chip: chip, progressBar: progressBar, barChart: barChart, hBars: hBars, tabs: tabs,
    computeMeta: computeMeta, metaParaVenda: metaParaVenda, META_STATUS: META_STATUS
  };
})();
