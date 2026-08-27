/* Utilidades gerais - formatação de moeda, datas, telefone, exportação */
window.U = (function () {
  const DAY = 86400000;

  function uid() { return 'id' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function nowISO() { return new Date().toISOString(); }
  function todayISO() { return iso(new Date()); }

  function iso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + da;
  }
  function dateFromISO(s) {
    if (!s) return null;
    const p = String(s).slice(0, 10).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function fmtDate(s) { const d = dateFromISO(s); return d ? d.toLocaleDateString('pt-BR') : '—'; }
  function fmtDateTime(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function brl(n) { n = Number(n) || 0; return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function brlShort(n) { n = Number(n) || 0; return 'R$ ' + n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }

  /* aceita "1.000.000,00", "300000", "R$ 1.850,50" -> número */
  function parseNumber(str) {
    if (typeof str === 'number') return str;
    if (!str) return 0;
    str = String(str).trim().replace(/[R$\s.]/g, '').replace(',', '.');
    const n = parseFloat(str);
    return isNaN(n) ? 0 : n;
  }

  function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }
  function fmtPhone(s) {
    const d = onlyDigits(s);
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return s || '—';
  }
  function waLink(s) { let d = onlyDigits(s); if (!d) return '#'; if (d.length <= 11) d = '55' + d; return 'https://wa.me/' + d; }
  function telLink(s) { return 'tel:' + onlyDigits(s); }

  function daysBetween(a, b) {
    const da = a instanceof Date ? a : dateFromISO(a);
    const db = b instanceof Date ? b : dateFromISO(b);
    return Math.round((db - da) / DAY);
  }
  function addDays(d, n) {
    const b = d instanceof Date ? new Date(d.getTime()) : dateFromISO(d);
    b.setDate(b.getDate() + n);
    return b;
  }
  function clamp(n, mn, mx) { return Math.max(mn, Math.min(mx, n)); }
  function pct(part, whole) { whole = Number(whole) || 0; if (!whole) return 0; return (Number(part) || 0) / whole * 100; }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function startOfWeek(d) {
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7; // segunda = 0
    x.setDate(x.getDate() - day);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  /* Devolve { ini, fim } em ISO para os presets de período */
  function range(preset, custom) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let ini, fim;
    switch (preset) {
      case 'hoje': ini = new Date(today); fim = new Date(today); break;
      case 'semana': ini = startOfWeek(today); fim = addDays(ini, 6); break;
      case '7d': ini = addDays(today, -6); fim = new Date(today); break;
      case '30d': ini = addDays(today, -29); fim = new Date(today); break;
      case 'mes': ini = new Date(today.getFullYear(), today.getMonth(), 1); fim = new Date(today.getFullYear(), today.getMonth() + 1, 0); break;
      case 'mes_anterior': ini = new Date(today.getFullYear(), today.getMonth() - 1, 1); fim = new Date(today.getFullYear(), today.getMonth(), 0); break;
      case 'ano': ini = new Date(today.getFullYear(), 0, 1); fim = new Date(today.getFullYear(), 11, 31); break;
      case 'custom':
        ini = dateFromISO(custom && custom.ini) || addDays(today, -29);
        fim = dateFromISO(custom && custom.fim) || new Date(today);
        break;
      default: ini = new Date(1970, 0, 1); fim = new Date(2999, 11, 31);
    }
    return { ini: iso(ini), fim: iso(fim) };
  }
  function inRange(dISO, r) {
    if (!dISO) return false;
    const d = String(dISO).slice(0, 10);
    return d >= r.ini && d <= r.fim;
  }

  /* ---------- exportação ---------- */
  function downloadBlob(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 100);
  }
  function toCSV(headers, rows) {
    const q = function (v) {
      v = v == null ? '' : String(v);
      return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const lines = [headers.map(q).join(';')];
    rows.forEach(function (r) { lines.push(r.map(q).join(';')); });
    return '﻿' + lines.join('\r\n'); // BOM para o Excel abrir em UTF-8
  }
  function openPrint(title, bodyHTML) {
    const w = window.open('', '_blank');
    if (!w) { alert('Permita pop-ups neste site para gerar o PDF.'); return; }
    w.document.write(
      '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' +
      'body{font-family:Arial,Helvetica,sans-serif;color:#1b2430;margin:26px;font-size:12px}' +
      'h1{font-size:19px;margin:0 0 2px}h2{font-size:13px;margin:18px 0 6px;border-bottom:2px solid #1E2D47;padding-bottom:3px}' +
      '.sub{color:#666;margin-bottom:14px}' +
      'table{width:100%;border-collapse:collapse;margin:8px 0;font-size:11px}' +
      'th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}th{background:#1E2D47;color:#fff}.num{text-align:right}' +
      '.cards{display:flex;flex-wrap:wrap;gap:10px;margin:10px 0}' +
      '.c{border:1px solid #ccc;border-radius:8px;padding:8px 12px;min-width:130px}.c span{color:#666;font-size:10px}.c b{display:block;font-size:15px}' +
      '@media print{.noprint{display:none}}</style></head><body>' + bodyHTML +
      '<div class="noprint" style="margin-top:22px"><button onclick="window.print()">Imprimir / Salvar como PDF</button></div>' +
      '<scr' + 'ipt>setTimeout(function(){window.print()},500)</scr' + 'ipt></body></html>'
    );
    w.document.close();
  }

  return {
    DAY: DAY, uid: uid, nowISO: nowISO, todayISO: todayISO, iso: iso, dateFromISO: dateFromISO,
    fmtDate: fmtDate, fmtDateTime: fmtDateTime, brl: brl, brlShort: brlShort, parseNumber: parseNumber,
    onlyDigits: onlyDigits, fmtPhone: fmtPhone, waLink: waLink, telLink: telLink,
    daysBetween: daysBetween, addDays: addDays, clamp: clamp, pct: pct, el: el, esc: esc,
    startOfWeek: startOfWeek, range: range, inRange: inRange,
    downloadBlob: downloadBlob, toCSV: toCSV, openPrint: openPrint
  };
})();
