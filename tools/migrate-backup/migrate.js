/* =============================================================================
 *  Ferramenta de migração — backup do CRM (localStorage)  ->  Supabase
 * -----------------------------------------------------------------------------
 *  Princípios (não podem ser violados):
 *   - NÃO executa nada sozinha. Cada passo exige um clique do usuário.
 *   - SÓ faz INSERT de registros NOVOS (id inexistente no Supabase).
 *   - NUNCA faz update, upsert ou delete. Nunca sobrescreve registro existente.
 *   - NUNCA toca no Supabase Auth. Não cria usuários de login. Não importa senha.
 *   - NUNCA migra `consultores` (não há tabela) nem `config` (feito à parte).
 *   - Coleções vazias no backup (simulacoes/propostas/vendas) são ignoradas.
 *   - IDs originais são preservados exatamente. `historico.leadId` é preservado.
 *   - Qualquer dúvida de conflito é apenas RELATADA, nunca resolvida sozinha.
 * ========================================================================== */
(function () {
  'use strict';

  /* ---------- plano por coleção ---------- */
  var PLAN = {
    usuarios:    { table: 'usuarios',    migrate: true,  strip: ['senha'] },
    consultores: { table: null,          migrate: false, motivo: 'Não existe tabela "consultores" no Supabase — ignorado por definição.' },
    produtos:    { table: 'produtos',    migrate: true },
    indicadores: { table: 'indicadores', migrate: true },
    leads:       { table: 'leads',       migrate: true },
    simulacoes:  { table: 'simulacoes',  migrate: true,  skipIfEmpty: true },
    propostas:   { table: 'propostas',   migrate: true,  skipIfEmpty: true },
    vendas:      { table: 'vendas',      migrate: true,  skipIfEmpty: true },
    metas:       { table: 'metas',       migrate: true },
    historico:   { table: 'historico',   migrate: true },
    config:      { table: 'config',      migrate: false, motivo: 'Config é tratada à parte e NUNCA é sobrescrita automaticamente. Se desejado, migrar manualmente via SQL.' }
  };

  /* ordem de inserção (respeita dependências: usuários/leads antes de histórico) */
  var INSERT_ORDER = ['usuarios', 'produtos', 'indicadores', 'leads', 'metas', 'historico'];

  /* tabelas que precisam ser lidas para deduplicar */
  var READ_TABLES = ['usuarios', 'produtos', 'indicadores', 'leads', 'metas', 'historico'];

  var state = {
    client: null,
    session: null,
    backup: null,
    fileName: null,
    existing: {},               // table -> Set(ids já no Supabase)
    existingUsersByEmail: {},    // email(lower) -> id no Supabase
    analysis: null,
    migrationResults: null,
    log: []
  };

  /* ---------- utilidades de DOM / log ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function log(msg) {
    var line = new Date().toISOString() + '  ' + msg;
    state.log.push(line);
    var box = $('log');
    box.textContent += (box.textContent ? '\n' : '') + line;
    box.scrollTop = box.scrollHeight;
  }
  function setBanner(text, cls) {
    var b = $('banner');
    b.textContent = text;
    b.className = 'banner ' + (cls || '');
  }

  /* ---------- 1. carregar valores do config.js (opcional) ---------- */
  async function loadConfig() {
    var candidates = ['../../config.js', '../config.js', 'config.js'];
    for (var i = 0; i < candidates.length; i++) {
      try {
        var r = await fetch(candidates[i]);
        if (!r.ok) continue;
        var txt = await r.text();
        var url = (txt.match(/supabaseUrl:\s*["']([^"']+)["']/) || [])[1];
        var key = (txt.match(/supabaseAnonKey:\s*["']([^"']+)["']/) || [])[1];
        if (url) $('supaUrl').value = url;
        if (key) $('supaKey').value = key;
        log('config.js lido de ' + candidates[i] + '.');
        return;
      } catch (e) { /* tenta o próximo */ }
    }
    log('Não foi possível ler config.js automaticamente. Cole a URL e a anon key manualmente (são valores públicos).');
  }

  /* ---------- 2. conectar + login ---------- */
  async function connect() {
    if (!(window.supabase && window.supabase.createClient)) {
      log('ERRO: a lib @supabase/supabase-js não carregou (sem internet?). A ferramenta não pode continuar.');
      return;
    }
    var url = $('supaUrl').value.trim();
    var key = $('supaKey').value.trim();
    var email = $('email').value.trim().toLowerCase();
    var senha = $('senha').value;
    if (!url || !key) { log('Informe a URL e a anon key do Supabase.'); return; }
    if (!email || !senha) { log('Informe e-mail e senha de um usuário ADMIN do CRM (usado só para autenticar a leitura/gravação; a senha não é armazenada).'); return; }

    try {
      state.client = window.supabase.createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    } catch (e) {
      log('ERRO ao criar o client Supabase: ' + (e && e.message || e));
      return;
    }

    log('Autenticando como ' + email + ' …');
    var res;
    try { res = await state.client.auth.signInWithPassword({ email: email, password: senha }); }
    catch (e) { log('ERRO de rede no login: ' + (e && e.message || e)); return; }
    if (res.error) { log('Falha no login: ' + res.error.message); return; }

    state.session = res.data.session;
    state.loggedInEmail = email;
    $('senha').value = '';
    $('connState').textContent = 'conectado como ' + email;
    $('connState').className = 'ok';
    log('Login OK. Lendo o que já existe no Supabase para deduplicar…');

    await loadExisting();
    $('btnAnalyze').disabled = !(state.backup && Object.keys(state.existing).length);
    maybeEnableAnalyze();
  }

  async function loadExisting() {
    state.existing = {};
    state.existingUsersByEmail = {};
    for (var i = 0; i < READ_TABLES.length; i++) {
      var t = READ_TABLES[i];
      try {
        var sel = (t === 'usuarios') ? 'id, data' : 'id';
        var res = await state.client.from(t).select(sel);
        if (res.error) { log('ERRO ao ler "' + t + '": ' + res.error.message + ' (essa coleção ficará BLOQUEADA para migração)'); continue; }
        var set = new Set();
        (res.data || []).forEach(function (row) {
          set.add(row.id);
          if (t === 'usuarios' && row.data && row.data.email) {
            state.existingUsersByEmail[String(row.data.email).trim().toLowerCase()] = row.id;
          }
        });
        state.existing[t] = set;
        log('  "' + t + '": ' + set.size + ' registro(s) já no Supabase.');
      } catch (e) {
        log('EXCEÇÃO ao ler "' + t + '": ' + (e && e.message || e));
      }
    }
  }

  /* ---------- 3. carregar o arquivo de backup ---------- */
  function readBackupFile(file) {
    state.fileName = file.name;
    var done = function (text) {
      var pkg;
      try { pkg = JSON.parse(text); }
      catch (e) { log('Arquivo inválido: não é JSON.'); return; }
      var ok = pkg && typeof pkg === 'object' &&
        pkg.tipo === 'crm-backup' && pkg.chave === 'crm_consorcio_v1' &&
        pkg.dados && typeof pkg.dados === 'object' && !Array.isArray(pkg.dados);
      if (!ok) { log('Arquivo inválido: não parece um backup do CRM (tipo/chave/dados).'); return; }
      state.backup = pkg.dados;
      $('fileState').textContent = file.name + '  —  exportado em ' + (pkg.exportadoEm || '?');
      $('fileState').className = 'ok';
      log('Backup carregado: ' + file.name);
      previewCounts();
      maybeEnableAnalyze();
    };
    if (typeof file.text === 'function') file.text().then(done, function () { log('Falha ao ler o arquivo.'); });
    else { var fr = new FileReader(); fr.onload = function () { done(String(fr.result)); }; fr.readAsText(file); }
  }

  function previewCounts() {
    var d = state.backup, rows = [];
    Object.keys(PLAN).forEach(function (name) {
      var n = (name === 'config') ? (d.config ? 1 : 0) : (Array.isArray(d[name]) ? d[name].length : 0);
      rows.push('<tr><td>' + name + '</td><td class="num">' + n + '</td></tr>');
    });
    $('report').innerHTML = '<h3>Registros no backup</h3><table><thead><tr><th>Coleção</th><th class="num">Total</th></tr></thead><tbody>' +
      rows.join('') + '</tbody></table><p class="muted">Nenhuma análise contra o Supabase ainda. Nenhuma escrita foi feita.</p>';
  }

  function maybeEnableAnalyze() {
    $('btnAnalyze').disabled = !(state.backup && state.client && Object.keys(state.existing).length);
  }

  /* ---------- 4. analisar (somente leitura) ---------- */
  function analyze() {
    if (!state.backup || !state.client) return;
    var d = state.backup;
    var backupLeadIds = new Set((Array.isArray(d.leads) ? d.leads : []).map(function (r) { return r && r.id; }));

    var result = {
      generatedAt: new Date().toISOString(),
      file: state.fileName,
      supabaseUrl: $('supaUrl').value.trim(),
      loggedInAs: state.loggedInEmail,
      canMigrate: true,
      collections: {}
    };

    Object.keys(PLAN).forEach(function (name) {
      var p = PLAN[name];
      var arr = Array.isArray(d[name]) ? d[name] : [];
      var rec = {
        name: name, table: p.table,
        total: (name === 'config') ? (d.config ? 1 : 0) : arr.length,
        novos: [], jaExistentes: [], conflitos: [], ignorados: [], acao: ''
      };

      if (!p.migrate) {
        rec.acao = 'IGNORAR — ' + (p.motivo || '');
        if (name !== 'config') arr.forEach(function (r) { rec.ignorados.push({ id: r && r.id, motivo: p.motivo }); });
        result.collections[name] = rec; return;
      }
      if (arr.length === 0) {
        rec.acao = p.skipIfEmpty ? 'IGNORAR — coleção vazia no backup' : 'Nada a migrar (vazio)';
        result.collections[name] = rec; return;
      }

      var existingSet = state.existing[p.table];
      if (!existingSet) {
        rec.acao = 'BLOQUEADO — não foi possível ler "' + p.table + '" no Supabase. Migração desta coleção NÃO será permitida.';
        result.canMigrate = false;
        result.collections[name] = rec; return;
      }

      var seen = {};
      arr.forEach(function (r) {
        var id = r && r.id;
        if (!id) { rec.conflitos.push({ id: null, motivo: 'registro sem id' }); return; }
        if (seen[id]) { rec.conflitos.push({ id: id, motivo: 'id repetido dentro do próprio backup' }); return; }
        seen[id] = true;

        if (existingSet.has(id)) {
          rec.jaExistentes.push({ id: id, motivo: 'id já existe no Supabase (conteúdo NÃO comparado; registro do servidor é mantido)' });
          return;
        }

        if (name === 'usuarios') {
          var email = String(r.email || '').trim().toLowerCase();
          var other = email && state.existingUsersByEmail[email];
          if (other && other !== id) {
            rec.conflitos.push({ id: id, motivo: 'e-mail "' + email + '" já existe no Supabase com id diferente (' + other + '). NÃO resolvido automaticamente — decida manualmente.' });
            return;
          }
          rec.novos.push({ id: id, motivo: 'usuário novo — inserido SEM senha e SEM auth_uid. NÃO poderá fazer login até ser vinculado manualmente no Supabase Auth.' });
          return;
        }

        if (name === 'historico') {
          var lid = r.leadId;
          var known = lid && (backupLeadIds.has(lid) || (state.existing.leads && state.existing.leads.has(lid)));
          if (!known) {
            rec.conflitos.push({ id: id, motivo: 'leadId "' + lid + '" não existe nem no backup nem no Supabase (histórico órfão)' });
            return;
          }
        }

        rec.novos.push({ id: id });
      });

      rec.acao = 'migrar ' + rec.novos.length + ' novo(s) · pular ' + rec.jaExistentes.length + ' existente(s) · ' + rec.conflitos.length + ' conflito(s) não resolvido(s)';
      result.collections[name] = rec;
    });

    state.analysis = result;
    renderReport(result);
    log('Análise concluída. NENHUMA escrita foi feita.');

    var totalNovos = 0, totalConf = 0;
    Object.keys(result.collections).forEach(function (k) {
      totalNovos += result.collections[k].novos.length;
      totalConf += result.collections[k].conflitos.length;
    });
    $('btnMigrate').disabled = !(result.canMigrate && totalNovos > 0);
    $('btnDownloadLog').disabled = false;
    if (!result.canMigrate) setBanner('Análise feita. Migração BLOQUEADA: alguma tabela não pôde ser lida. Nenhuma escrita possível.', 'warn');
    else setBanner('Análise feita. ' + totalNovos + ' registro(s) novo(s) prontos para inserir, ' + totalConf + ' conflito(s) a decidir. NENHUMA escrita foi feita ainda.', 'ok');
  }

  function renderReport(result) {
    var html = '<h3>Relatório de análise</h3>';
    html += '<p class="muted">Arquivo: ' + esc(result.file) + ' · Supabase: ' + esc(result.supabaseUrl) + ' · login: ' + esc(result.loggedInAs) + '</p>';
    html += '<table><thead><tr><th>Coleção</th><th class="num">Total</th><th class="num">Novos</th><th class="num">Já existentes</th><th class="num">Conflitos</th><th>Ação</th></tr></thead><tbody>';
    Object.keys(result.collections).forEach(function (k) {
      var r = result.collections[k];
      html += '<tr>' +
        '<td>' + k + '</td>' +
        '<td class="num">' + r.total + '</td>' +
        '<td class="num">' + r.novos.length + '</td>' +
        '<td class="num">' + r.jaExistentes.length + '</td>' +
        '<td class="num' + (r.conflitos.length ? ' bad' : '') + '">' + r.conflitos.length + '</td>' +
        '<td>' + esc(r.acao) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';

    /* detalhamento dos conflitos e avisos */
    var detalhes = '';
    Object.keys(result.collections).forEach(function (k) {
      var r = result.collections[k];
      var linhas = [];
      r.conflitos.forEach(function (x) { linhas.push('<li class="bad">CONFLITO · ' + esc(k) + ' · id ' + esc(x.id) + ' — ' + esc(x.motivo) + '</li>'); });
      r.novos.forEach(function (x) { if (x.motivo) linhas.push('<li class="warn">AVISO · ' + esc(k) + ' · id ' + esc(x.id) + ' — ' + esc(x.motivo) + '</li>'); });
      if (linhas.length) detalhes += linhas.join('');
    });
    if (detalhes) html += '<h4>Conflitos e avisos (não resolvidos automaticamente)</h4><ul class="detalhes">' + detalhes + '</ul>';

    html += '<p class="muted">A migração insere APENAS os "novos". "Já existentes" e "conflitos" são pulados. Nada é apagado ou sobrescrito.</p>';
    $('report').innerHTML = html;
  }

  /* ---------- 5. converter para linha do banco ---------- */
  function toRow(collection, obj) {
    var p = PLAN[collection];
    var data = {};
    Object.keys(obj).forEach(function (k) { if (k !== 'id') data[k] = obj[k]; });
    (p.strip || []).forEach(function (f) { delete data[f]; });
    return { id: obj.id, data: JSON.parse(JSON.stringify(data)) };
  }

  /* ---------- 6. executar migração (só INSERT de novos) ---------- */
  async function runMigration() {
    if (!state.analysis || !state.analysis.canMigrate) return;

    var typed = window.prompt(
      'Isto vai INSERIR registros NOVOS no Supabase:\n  ' + $('supaUrl').value.trim() +
      '\n\nNada será apagado, atualizado ou sobrescrito.\nConflitos e registros já existentes serão pulados.\n\nDigite  MIGRAR  para confirmar:'
    );
    if (typed !== 'MIGRAR') { log('Migração CANCELADA pelo usuário.'); return; }

    $('btnMigrate').disabled = true;
    $('btnAnalyze').disabled = true;
    setBanner('Migrando… não feche esta aba.', 'warn');
    log('=== INÍCIO DA MIGRAÇÃO ===');

    var results = {};
    for (var oi = 0; oi < INSERT_ORDER.length; oi++) {
      var collection = INSERT_ORDER[oi];
      var rec = state.analysis.collections[collection];
      if (!rec || !rec.novos.length) { continue; }

      var p = PLAN[collection];
      var byId = {};
      (state.backup[collection] || []).forEach(function (r) { byId[r.id] = r; });
      var rows = rec.novos.map(function (n) { return toRow(collection, byId[n.id]); });

      results[collection] = { tentados: rows.length, inseridos: 0, falhas: 0, erros: [] };
      log('Coleção "' + collection + '": inserindo ' + rows.length + ' registro(s)…');

      for (var c = 0; c < rows.length; c += 50) {
        var chunk = rows.slice(c, c + 50);
        var res;
        try { res = await state.client.from(p.table).insert(chunk).select('id'); }
        catch (e) { res = { error: { message: String(e && e.message || e) } }; }

        if (res.error) {
          log('  lote falhou (' + res.error.message + ') — tentando um a um…');
          for (var ri = 0; ri < chunk.length; ri++) {
            var one;
            try { one = await state.client.from(p.table).insert(chunk[ri]).select('id'); }
            catch (e2) { one = { error: { message: String(e2 && e2.message || e2) } }; }
            if (one.error) {
              results[collection].falhas++;
              results[collection].erros.push({ id: chunk[ri].id, erro: one.error.message });
              log('    FALHA ' + chunk[ri].id + ': ' + one.error.message);
            } else {
              results[collection].inseridos++;
              log('    OK ' + chunk[ri].id);
            }
          }
        } else {
          results[collection].inseridos += chunk.length;
          log('  OK lote de ' + chunk.length);
        }
      }
    }

    state.migrationResults = results;
    log('=== FIM DA MIGRAÇÃO ===');
    var total = 0, falhas = 0;
    Object.keys(results).forEach(function (k) { total += results[k].inseridos; falhas += results[k].falhas; });
    setBanner('Migração concluída: ' + total + ' inserido(s), ' + falhas + ' falha(s). Config e Auth NÃO foram tocados.', falhas ? 'warn' : 'ok');
    renderMigrationResults(results);
    $('btnDownloadLog').disabled = false;
  }

  function renderMigrationResults(results) {
    var html = '<h3>Resultado da migração</h3><table><thead><tr><th>Coleção</th><th class="num">Tentados</th><th class="num">Inseridos</th><th class="num">Falhas</th></tr></thead><tbody>';
    Object.keys(results).forEach(function (k) {
      var r = results[k];
      html += '<tr><td>' + k + '</td><td class="num">' + r.tentados + '</td><td class="num">' + r.inseridos + '</td><td class="num' + (r.falhas ? ' bad' : '') + '">' + r.falhas + '</td></tr>';
    });
    html += '</tbody></table>';
    $('report').insertAdjacentHTML('beforeend', html);
  }

  /* ---------- 7. baixar log/relatório ---------- */
  function downloadLog() {
    var pkg = {
      ferramenta: 'migrate-backup',
      geradoEm: new Date().toISOString(),
      arquivoBackup: state.fileName,
      supabaseUrl: $('supaUrl').value.trim(),
      loginUsado: state.loggedInEmail,
      analise: state.analysis,
      resultadoMigracao: state.migrationResults,
      log: state.log
    };
    var blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'migracao-log-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }

  /* ---------- wiring ---------- */
  window.addEventListener('DOMContentLoaded', function () {
    setBanner('Pronta. Nenhuma conexão feita, nenhum dado lido ou escrito.', '');
    $('btnLoadConfig').onclick = loadConfig;
    $('btnConnect').onclick = connect;
    $('btnAnalyze').onclick = analyze;
    $('btnMigrate').onclick = runMigration;
    $('btnDownloadLog').onclick = downloadLog;
    $('file').onchange = function () { if (this.files && this.files[0]) readBackupFile(this.files[0]); };
    $('btnAnalyze').disabled = true;
    $('btnMigrate').disabled = true;
    $('btnDownloadLog').disabled = true;
    loadConfig();
  });
})();
