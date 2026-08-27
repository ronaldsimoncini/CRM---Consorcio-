/* Painel de Metas para TV — página isolada.
   Fonte dos dados: [a] /api/painel?tv=TOKEN quando publicado  [b] localStorage do CRM no modo local.
   NUNCA mostra cliente, venda individual ou dado administrativo — só o agregado da meta. */
(function () {
  'use strict';

  const DAY = 86400000;
  const token = getToken();
  const STATE = { prevVendido: null, shown: null, built: false, nvTimer: null };

  /* ---------- helpers ---------- */
  function getToken() {
    try {
      const u = new URL(location.href);
      let t = u.searchParams.get('tv');
      if (!t) { const m = location.pathname.match(/painel-tv\/([^/?#]+)/); if (m) t = decodeURIComponent(m[1]); }
      return t || '';
    } catch (e) { return ''; }
  }
  function brl(n) { return (Math.round(Number(n) || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function todayISO() { return iso(new Date()); }
  function dateFromISO(s) { if (!s) return null; const p = String(s).slice(0, 10).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function days(a, b) { return Math.round((b - a) / DAY); }
  function addDays(d, n) { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function fmtDMY(s) { const d = dateFromISO(s); return d ? d.toLocaleDateString('pt-BR') : '—'; }

  /* ---------- obtenção do agregado ---------- */
  async function fetchAggregate() {
    if (location.protocol.indexOf('http') === 0) {
      try {
        const r = await fetch('/api/painel?tv=' + encodeURIComponent(token), { cache: 'no-store' });
        if (r.ok) { const j = await r.json(); if (j && j.ok !== false) return j; }
      } catch (e) { /* cai para o modo local */ }
    }
    return computeLocal();
  }

  function computeLocal() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem('crm_consorcio_v1') || 'null'); } catch (e) { raw = null; }
    if (!raw) return { ok: false, motivo: 'sem_dados' };
    const cfg = raw.config || {};
    const metas = raw.metas || [];
    const vendas = (raw.vendas || []).filter(function (v) { return v.status === 'venda_realizada'; });

    let meta = null;
    const tk = (cfg.painelTokens || []).find(function (t) { return t.token === token; });
    if (tk && tk.metaId) meta = metas.find(function (m) { return m.id === tk.metaId; });
    if (!meta) {
      const hoje = todayISO();
      const equipe = metas.filter(function (m) { return m.tipo === 'equipe' && m.statusManual !== 'encerrada'; });
      meta = equipe.filter(function (m) { return !m.dataFim || m.dataFim >= hoje; })
        .sort(function (a, b) { return (a.dataFim || '') < (b.dataFim || '') ? -1 : 1; })[0]
        || equipe.sort(function (a, b) { return (b.dataFim || '') < (a.dataFim || '') ? -1 : 1; })[0]
        || metas[0];
    }
    if (!meta) return { ok: false, motivo: 'sem_meta', empresa: cfg.empresa };
    if (!meta.dataInicio || !meta.dataFim) return { ok: false, motivo: 'sem_meta', empresa: cfg.empresa };
    const linked = vendas.filter(function (v) { return v.metaId === meta.id; });
    return buildAggregate(meta, linked, cfg.empresa);
  }

  function buildAggregate(meta, vendas, empresa) {
    const valorMeta = Number(meta.valorMeta) || 0;
    const ordered = vendas.slice().sort(function (a, b) { return (a.dataVenda || '') < (b.dataVenda || '') ? -1 : 1; });
    const vendido = ordered.reduce(function (s, v) { return s + (Number(v.valorCredito) || 0); }, 0);
    const restante = Math.max(valorMeta - vendido, 0);
    const excedente = Math.max(vendido - valorMeta, 0);
    const percentual = valorMeta ? vendido / valorMeta * 100 : 0;

    const byDay = {};
    ordered.forEach(function (v) { const d = v.dataVenda || meta.dataInicio; byDay[d] = (byDay[d] || 0) + (Number(v.valorCredito) || 0); });
    const timeline = [{ d: meta.dataInicio, acc: 0 }];
    let acc = 0;
    Object.keys(byDay).sort().forEach(function (d) { acc += byDay[d]; timeline.push({ d: d, acc: acc }); });

    const di = dateFromISO(meta.dataInicio), df = dateFromISO(meta.dataFim), hoje = dateFromISO(todayISO());
    const diasTotais = Math.max(days(di, df) + 1, 1);
    const diasDecorridos = clamp(days(di, hoje) + 1, 0, diasTotais);
    const diasRestantes = Math.max(days(hoje, df), 0);
    const esperadoHoje = valorMeta * (diasDecorridos / diasTotais);
    const acima = vendido >= esperadoHoje;
    const ritmoDia = diasDecorridos > 0 ? vendido / diasDecorridos : 0;
    let projecaoData = null;
    if (ritmoDia > 0 && restante > 0) projecaoData = iso(addDays(hoje, Math.ceil(restante / ritmoDia)));

    let status = 'em_andamento';
    if (valorMeta > 0 && vendido > valorMeta) status = 'superada';
    else if (valorMeta > 0 && vendido >= valorMeta) status = 'atingida';

    return {
      ok: true, empresa: empresa || 'CRM',
      meta: { nome: meta.nome, valorMeta: valorMeta, dataInicio: meta.dataInicio, dataFim: meta.dataFim },
      vendido: vendido, restante: restante, excedente: excedente, percentual: percentual, status: status,
      ritmo: { esperadoHoje: esperadoHoje, acima: acima, diasRestantes: diasRestantes, projecaoData: projecaoData },
      timeline: timeline, totalVendas: ordered.length, geradoEm: new Date().toISOString()
    };
  }

  /* ---------- gráfico de linha (SVG) ---------- */
  function chartSVG(agg) {
    const W = 1000, Hh = 460, padL = 12, padR = 14, padT = 24, padB = 40;
    const di = dateFromISO(agg.meta.dataInicio).getTime();
    const df = dateFromISO(agg.meta.dataFim).getTime();
    const now = Math.min(Date.now(), df);
    const span = Math.max(df - di, DAY);
    const yMax = Math.max(agg.meta.valorMeta, agg.vendido) * 1.08 || 1;

    const X = function (t) { return padL + (clamp(t, di, df) - di) / span * (W - padL - padR); };
    const Y = function (v) { return Hh - padB - (v / yMax) * (Hh - padT - padB); };

    // linha acumulada (parada em "hoje")
    let pts = agg.timeline.map(function (p) { return [X(dateFromISO(p.d).getTime()), Y(p.acc)]; });
    const lastAcc = agg.timeline.length ? agg.timeline[agg.timeline.length - 1].acc : 0;
    pts.push([X(now), Y(lastAcc)]);
    const poly = pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    const area = 'M ' + poly.split(' ').join(' L ') + ' L ' + X(now).toFixed(1) + ',' + Y(0).toFixed(1) + ' L ' + X(di).toFixed(1) + ',' + Y(0).toFixed(1) + ' Z';

    // ticks Y
    let yTicks = '';
    for (let i = 0; i <= 4; i++) {
      const v = yMax * i / 4, y = Y(v);
      yTicks += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="rgba(255,255,255,.10)"/>' +
        '<text x="' + padL + '" y="' + (y - 6).toFixed(1) + '" fill="#9FB4CC" font-size="15">' + shortBRL(v) + '</text>';
    }
    // ticks X
    let xTicks = '';
    for (let i = 0; i <= 4; i++) {
      const t = di + span * i / 4, x = X(t);
      xTicks += '<text x="' + x.toFixed(1) + '" y="' + (Hh - 12) + '" fill="#9FB4CC" font-size="15" text-anchor="middle">' + fmtDMY(iso(new Date(t))).slice(0, 5) + '</text>';
    }

    const yMeta = Y(agg.meta.valorMeta);
    const xNow = X(now);

    return '<svg viewBox="0 0 ' + W + ' ' + Hh + '" preserveAspectRatio="xMidYMid meet">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#37D07A" stop-opacity=".35"/><stop offset="1" stop-color="#37D07A" stop-opacity="0"/></linearGradient></defs>' +
      yTicks + xTicks +
      '<path d="' + area + '" fill="url(#g)"/>' +
      '<polyline points="' + poly + '" fill="none" stroke="#37D07A" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<line x1="' + padL + '" y1="' + yMeta.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + yMeta.toFixed(1) + '" stroke="#E7B961" stroke-width="2.5" stroke-dasharray="10 8"/>' +
      '<text x="' + (W - padR) + '" y="' + (yMeta - 10).toFixed(1) + '" fill="#E7B961" font-size="17" font-weight="700" text-anchor="end">META ' + brl(agg.meta.valorMeta) + '</text>' +
      '<line x1="' + xNow.toFixed(1) + '" y1="' + padT + '" x2="' + xNow.toFixed(1) + '" y2="' + (Hh - padB) + '" stroke="rgba(255,255,255,.35)" stroke-width="1.5" stroke-dasharray="3 5"/>' +
      '<circle cx="' + xNow.toFixed(1) + '" cy="' + Y(lastAcc).toFixed(1) + '" r="7" fill="#37D07A" stroke="#0A1A2F" stroke-width="3"/>' +
      '</svg>';
  }
  function shortBRL(v) {
    if (v >= 1e6) return 'R$ ' + (v / 1e6).toFixed(1).replace('.', ',') + ' mi';
    if (v >= 1e3) return 'R$ ' + Math.round(v / 1e3) + ' mil';
    return 'R$ ' + Math.round(v);
  }

  /* ---------- render ---------- */
  const STATUS_TXT = { em_andamento: 'META EM ANDAMENTO', atingida: 'META ATINGIDA 🎉', superada: 'META SUPERADA 🚀', sem_meta: '—' };

  function layoutHTML(agg) {
    return '' +
      '<div class="pt-top">' +
      '<div class="pt-emp">' + esc(agg.empresa) + '<small>PAINEL DE METAS</small></div>' +
      '<div style="text-align:right"><div class="pt-clock" id="pt-clock">--:--</div>' +
      '<div class="pt-meta-nome" id="meta-nome">' + esc(agg.meta.nome) + '</div></div>' +
      '</div>' +
      '<div class="pt-body">' +
      '<div class="pt-stats">' +
      stat('meta', '🎯 META', 's-meta') +
      stat('vendido', '💰 VENDIDO', 's-vendido') +
      stat('pct', '📊 META ATINGIDA', 's-pct') +
      stat('falta', '💵 FALTA PARA A META', 's-falta') +
      '<div class="pt-prog"><div class="pt-prog-track"><div class="pt-prog-fill" id="prog-fill" style="width:0%"></div></div></div>' +
      '</div>' +
      '<div class="pt-chart"><h2>EVOLUÇÃO DAS VENDAS</h2><div id="chart"></div></div>' +
      '</div>' +
      '<div class="pt-foot">' +
      '<div class="pt-badge status" id="b-status"><div class="lb">STATUS</div><div class="vl">—</div></div>' +
      '<div class="pt-badge ritmo" id="b-ritmo"><div class="lb">RITMO</div><div class="vl">—</div></div>' +
      '<div class="pt-badge" id="b-prazo"><div class="lb">PERÍODO</div><div class="vl">—</div></div>' +
      '</div>';
  }
  function stat(cls, lb, id) {
    return '<div class="pt-stat ' + cls + '"><div class="lb">' + lb + '</div><div class="vl" id="' + id + '">R$ 0</div></div>';
  }

  function animateNumber(el, from, to, fmt) {
    if (!el) return;
    if (Math.abs(to - from) < 0.5) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 900;
    function step(now) {
      const k = Math.min((now - t0) / dur, 1), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function paint(agg) {
    const root = document.getElementById('painel');
    if (!agg.ok) {
      STATE.built = false;
      root.className = '';
      root.innerHTML = '<div class="pt-erro"><b>Painel de Metas</b>' +
        (agg.motivo === 'sem_meta'
          ? 'Nenhuma meta de equipe ativa. Crie uma meta na aba <b>Metas</b> do CRM.'
          : 'Sem dados. Abra o CRM neste mesmo computador/navegador e cadastre uma meta, ou publique o sistema para receber os dados da nuvem.') +
        '</div>';
      return;
    }
    if (!STATE.built) {
      root.className = '';
      root.innerHTML = layoutHTML(agg);
      STATE.built = true;
      STATE.shown = { vendido: 0, pct: 0, restante: agg.meta.valorMeta };
      tickClock();
    }

    document.getElementById('s-meta').textContent = brl(agg.meta.valorMeta);
    animateNumber(document.getElementById('s-vendido'), STATE.shown.vendido, agg.vendido, brl);
    animateNumber(document.getElementById('s-pct'), STATE.shown.pct, agg.percentual, function (v) { return v.toFixed(0) + '%'; });
    animateNumber(document.getElementById('s-falta'), STATE.shown.restante, agg.restante, brl);
    document.getElementById('prog-fill').style.width = clamp(agg.percentual, 0, 100) + '%';
    document.getElementById('chart').innerHTML = chartSVG(agg);
    document.getElementById('meta-nome').textContent = agg.meta.nome;

    const bs = document.getElementById('b-status');
    bs.className = 'pt-badge status ' + agg.status;
    bs.querySelector('.vl').textContent = STATUS_TXT[agg.status] || '—';

    const br = document.getElementById('b-ritmo');
    br.className = 'pt-badge ritmo ' + (agg.ritmo.acima ? 'acima' : 'abaixo');
    br.querySelector('.vl').textContent = agg.status !== 'em_andamento'
      ? '—'
      : (agg.ritmo.acima ? 'ACIMA do necessário' : 'ABAIXO do necessário');

    const bp = document.getElementById('b-prazo');
    bp.querySelector('.vl').textContent = fmtDMY(agg.meta.dataInicio) + ' – ' + fmtDMY(agg.meta.dataFim) +
      (agg.ritmo.diasRestantes ? '  ·  ' + agg.ritmo.diasRestantes + ' dias' : '');

    STATE.shown = { vendido: agg.vendido, pct: agg.percentual, restante: agg.restante };
  }

  function maybeAnimate(agg) {
    if (!agg.ok) { STATE.prevVendido = null; return; }
    if (STATE.prevVendido != null && agg.vendido > STATE.prevVendido + 0.5) {
      showNovaVenda(agg.vendido - STATE.prevVendido);
    }
    STATE.prevVendido = agg.vendido;
  }
  function showNovaVenda(delta) {
    const el = document.getElementById('nova-venda');
    document.getElementById('nv-valor').textContent = '+ ' + brl(delta);
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add('show'); });
    const st = document.querySelector('.pt-stat.vendido');
    if (st) { st.classList.remove('bump'); void st.offsetWidth; st.classList.add('bump'); }
    clearTimeout(STATE.nvTimer);
    STATE.nvTimer = setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.hidden = true; }, 600);
    }, 6000);
  }

  /* ---------- ciclo ---------- */
  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try { const agg = await fetchAggregate(); paint(agg); maybeAnimate(agg); }
    catch (e) { console.error(e); }
    ticking = false;
  }
  function tickClock() {
    const c = document.getElementById('pt-clock');
    if (c) c.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- init ---------- */
  document.getElementById('fs-btn').onclick = function () {
    try {
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      if (document.documentElement.requestFullscreen) { document.documentElement.requestFullscreen().catch(function () {}); }
      else if (document.documentElement.webkitRequestFullscreen) { document.documentElement.webkitRequestFullscreen(); }
      else { alert('Neste aparelho a tela cheia é feita por "Adicionar à Tela de Início" (Safari) e abrindo pelo ícone.'); }
    } catch (e) { /* ignora */ }
  };
  document.addEventListener('keydown', function (e) { if ((e.key || '').toLowerCase() === 'f') document.getElementById('fs-btn').click(); });
  window.addEventListener('storage', function (e) { if (!e.key || e.key === 'crm_consorcio_v1') tick(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });

  tick();
  setInterval(tick, 12000);
  setInterval(tickClock, 15000);
})();
