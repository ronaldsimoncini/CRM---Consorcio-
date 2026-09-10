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

  /* ---------- render ---------- */

  function layoutHTML(agg) {
    return '' +
      '<div class="pt-top">' +
        '<div class="pt-brand">' + esc(agg.empresa) + '<span>PAINEL DE METAS</span></div>' +
        '<div class="pt-clock" id="pt-clock">--:--</div>' +
      '</div>' +
      '<div class="pt-stage">' +
        '<div class="pt-realizado">' +
          '<div class="pt-k">REALIZADO</div>' +
          '<div class="pt-realizado-vl" id="s-vendido">R$ 0</div>' +
        '</div>' +
        '<div class="pt-meta">' +
          '<div class="pt-k">META DO MÊS</div>' +
          '<div class="pt-meta-vl" id="s-meta">R$ 0</div>' +
        '</div>' +
        '<div class="pt-bar"><div class="pt-bar-fill" id="prog-fill" style="width:0%"></div></div>' +
        '<div class="pt-periodo" id="pt-periodo">—</div>' +
      '</div>';
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
    document.getElementById('prog-fill').style.width = clamp(agg.percentual, 0, 100) + '%';
    document.getElementById('pt-periodo').textContent = fmtDMY(agg.meta.dataInicio) + ' – ' + fmtDMY(agg.meta.dataFim);

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
    const st = document.getElementById('s-vendido');
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
