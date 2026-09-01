/* Leads (lista) + Funil (kanban) + ficha completa do lead + ações rápidas */
(function () {
  const H = {}; // helpers internos

  function scopedLeads() { return Auth.scope(Store.all('leads')); }
  function buildForm(html) { return U.el('<div class="form-grid">' + html + '</div>'); }
  function fval(b, n) { const e = b.querySelector('[name="' + n + '"]'); return e ? String(e.value).trim() : ''; }
  function fnum(b, n) { return U.parseNumber(fval(b, n)); }
  function admOpts(sel) { return C.opts(Store.config().administradoras, sel, { blank: '—' }); }
  function prodOpts(sel) {
    return C.opts(Store.all('produtos').filter(function (p) { return p.ativo; }).map(function (p) { return { value: p.id, label: p.nome }; }), sel, { blank: '—' });
  }

  function statusLead(l) {
    if (l.etapa === 'nao_fez') return { label: 'Não realizado', cls: 'st-bad' };
    if (l.vendaId) return { label: 'Cliente', cls: 'st-ok' };
    if (l.etapa === 'novo') return { label: 'Novo', cls: 'st-info' };
    return { label: 'Em atendimento', cls: 'st-warn' };
  }

  /* ---------------- Fase 2: dono (owner_uid) dos registros ----------------
     Regra: consultor logado -> a própria sessão; admin/gestor escolhendo um
     consultor -> o auth.uid() desse consultor (null enquanto ele não tiver
     login criado — aí o trigger do banco decide). Registros-filho (proposta,
     venda, simulação, histórico) seguem o dono do lead. */
  function ownerNovoLead(consultorId) {
    if (Auth.isConsultor()) return Auth.uid && Auth.uid();
    return (consultorId && Store.ownerUidFor) ? Store.ownerUidFor(consultorId) : null;
  }
  function ownerDoLead(lead, consultorIdFallback) {
    if (lead && lead.owner_uid) return lead.owner_uid;
    var cid = consultorIdFallback || (lead && lead.consultorId);
    return (cid && Store.ownerUidFor) ? Store.ownerUidFor(cid) : null;
  }
  function comOwner(rec, ownerUid) { if (ownerUid) rec.owner_uid = ownerUid; return rec; }

  /* ---------------- transições de etapa ---------------- */
  function transitionEtapa(lead, nova) {
    if (lead.etapa === nova) return;
    const de = Store.etapaLabel(lead.etapa), para = Store.etapaLabel(nova);
    Store.update('leads', lead.id, { etapa: nova, atualizadoEm: U.nowISO() });
    Store.logHist(lead.id, 'mudanca_etapa', 'Movido de ' + de + ' para ' + para, Auth.currentId());
  }

  function moveLead(leadId, nova) {
    const lead = Store.get('leads', leadId);
    if (!lead || lead.etapa === nova || !Auth.canEdit()) return;
    if (nova === 'reuniao_agendada') return H.reuniaoForm(lead);
    if (nova === 'reuniao_realizada') return H.reuniaoRealizadaForm(lead);
    if (nova === 'proposta_realizada') return H.propostaForm(lead);
    if (nova === 'fechamento') {
      if (lead.vendaId) { transitionEtapa(lead, nova); return; }
      return H.fecharVendaForm(lead);
    }
    if (nova === 'nao_fez') return H.motivoForm(lead);
    transitionEtapa(lead, nova);
    C.toast('Lead movido para ' + Store.etapaLabel(nova));
  }

  /* ---------------- formulários de ação ---------------- */
  H.reuniaoForm = function (lead, after) {
    const b = buildForm(
      C.field('Data', '<input type="date" name="data" value="' + U.todayISO() + '">') +
      C.field('Horário', '<input type="time" name="hora" value="09:00">') +
      C.field('Consultor', '<select name="cons">' + C.opts(C.usuariosConsultores(), lead.consultorId) + '</select>') +
      C.field('Observações', '<textarea name="obs"></textarea>', true)
    );
    C.modal('Agendar reunião', b, {
      saveLabel: 'Agendar', onSave: function () {
        const dados = { data: fval(b, 'data'), hora: fval(b, 'hora'), consultorId: fval(b, 'cons'), obs: fval(b, 'obs') };
        Store.batch(function () {
          transitionEtapa(lead, 'reuniao_agendada');
          /* fluxo unificado: cria/atualiza UM registro em 'reunioes' e sincroniza
             com o Google Calendar, reaproveitando a lógica do módulo Calendário.
             O objeto lead.reuniao (JSONB) continua sendo gravado para o cartão do
             Funil e guarda o id do registro para evitar duplicidade no reagendamento. */
          let row = null;
          if (window.Views && Views._reuniao && Views._reuniao.agendarParaLead) {
            try { row = Views._reuniao.agendarParaLead(lead, dados); }
            catch (e) { console.error('Falha ao sincronizar reunião do Funil:', e); }
          }
          Store.update('leads', lead.id, {
            reuniao: Object.assign({}, dados, row && row.id ? { reuniaoId: row.id } : {})
          });
          Store.logHist(lead.id, 'reuniao', 'Reunião agendada para ' + U.fmtDate(fval(b, 'data')) + ' às ' + fval(b, 'hora'), Auth.currentId());
        });
        C.toast('Reunião agendada.');
        if (after) after();
      }
    });
  };

  /* Reunião realizada: registra como foi a reunião. A etapa só muda ao SALVAR
     (se o usuário cancelar, o lead permanece na etapa em que estava — mesmo
     padrão dos demais formulários de transição do funil). A data/horário da
     reunião NÃO são apagados: o registro é gravado dentro do próprio objeto
     `lead.reuniao` (JSONB), reaproveitando a estrutura existente, e também no
     histórico do lead (Store.logHist). */
  H.reuniaoRealizadaForm = function (lead, after) {
    const b = buildForm(
      C.field('', '<div class="muted">Registre como foi a reunião com este lead.</div>', true) +
      C.field('Observações da reunião', '<textarea name="obs" rows="6"></textarea>', true)
    );
    C.modal('Reunião realizada', b, {
      saveLabel: 'SALVAR', cancelLabel: 'CANCELAR', onSave: function () {
        const texto = fval(b, 'obs');
        Store.batch(function () {
          transitionEtapa(lead, 'reuniao_realizada');
          const r = Object.assign(
            { data: '', hora: '', consultorId: lead.consultorId || '', obs: '' },
            lead.reuniao || {},
            { realizada: true, realizadaEm: U.nowISO(), observacao: texto }
          );
          Store.update('leads', lead.id, { reuniao: r });
          Store.logHist(lead.id, 'reuniao_realizada',
            'Reunião realizada' + (texto ? ': ' + texto : '.'), Auth.currentId());
        });
        C.toast('Reunião registrada.');
        if (after) after();
      }
    });
  };

  H.propostaForm = function (lead, after) {
    const b = buildForm(
      C.field('Valor do crédito (R$)', '<input name="cred" inputmode="decimal" value="' + (lead.valorCredito || '') + '">') +
      C.field('Valor da parcela (R$)', '<input name="parc" inputmode="decimal">') +
      C.field('Administradora', '<select name="adm">' + admOpts('') + '</select>') +
      C.field('Data', '<input type="date" name="data" value="' + U.todayISO() + '">') +
      C.field('Consultor', '<select name="cons">' + C.opts(C.usuariosConsultores(), lead.consultorId) + '</select>') +
      C.field('Observações', '<textarea name="obs"></textarea>', true)
    );
    C.modal('Registrar proposta', b, {
      saveLabel: 'Registrar', onSave: function () {
        const cred = fnum(b, 'cred');
        if (!cred) { alert('Informe o valor do crédito.'); return false; }
        Store.batch(function () {
          transitionEtapa(lead, 'proposta_realizada');
          Store.update('leads', lead.id, {
            valorCredito: cred,
            proposta: { valorCredito: cred, valorParcela: fnum(b, 'parc'), administradora: fval(b, 'adm'), data: fval(b, 'data'), consultorId: fval(b, 'cons') }
          });
          Store.insert('propostas', comOwner({
            leadId: lead.id, clienteNome: lead.nome, consultorId: fval(b, 'cons') || lead.consultorId,
            valorCredito: cred, valorParcela: fnum(b, 'parc'), administradora: fval(b, 'adm'),
            data: fval(b, 'data'), status: 'enviada', obs: fval(b, 'obs')
          }, ownerDoLead(lead, fval(b, 'cons'))));
          Store.logHist(lead.id, 'proposta', 'Proposta realizada: ' + U.brl(cred), Auth.currentId());
        });
        C.toast('Proposta registrada.');
        if (after) after();
      }
    });
  };

  H.fecharVendaForm = function (lead, after) {
    const p = lead.proposta || {};
    const b = buildForm(
      C.field('Cliente', '<input name="cliente" value="' + U.esc(lead.nome) + '">', true) +
      C.field('Telefone', '<input name="tel" value="' + U.esc(lead.telefone || '') + '">') +
      C.field('WhatsApp', '<input name="wpp" value="' + U.esc(lead.whatsapp || lead.telefone || '') + '">') +
      C.field('Consultor', '<select name="cons">' + C.opts(C.usuariosConsultores(), lead.consultorId) + '</select>') +
      C.field('Administradora', '<select name="adm">' + admOpts(p.administradora || '') + '</select>') +
      C.field('Produto', '<select name="prod">' + prodOpts('') + '</select>') +
      C.field('Valor do crédito (R$)', '<input name="cred" inputmode="decimal" value="' + (lead.valorCredito || p.valorCredito || '') + '">') +
      C.field('Valor da parcela (R$)', '<input name="parc" inputmode="decimal" value="' + (p.valorParcela || '') + '">') +
      C.field('Número da cota', '<input name="cota">') +
      C.field('Data da venda', '<input type="date" name="data" value="' + U.todayISO() + '">') +
      C.field('Comissão (R$)', '<input name="com" inputmode="decimal">') +
      C.field('Observações', '<textarea name="obs"></textarea>', true)
    );
    C.modal('Fechar venda', b, {
      saveLabel: 'Registrar venda', onSave: function () {
        const cred = fnum(b, 'cred');
        if (!cred) { alert('Informe o valor do crédito.'); return false; }
        Store.batch(function () {
          const v = {
            leadId: lead.id, cliente: fval(b, 'cliente') || lead.nome, telefone: fval(b, 'tel'), whatsapp: fval(b, 'wpp'),
            consultorId: fval(b, 'cons') || lead.consultorId, administradora: fval(b, 'adm'), produtoId: fval(b, 'prod') || null,
            valorCredito: cred, valorParcela: fnum(b, 'parc'), numeroCota: fval(b, 'cota'),
            dataVenda: fval(b, 'data'), origem: lead.origem, indicadorId: lead.indicadorId || null,
            comissao: fnum(b, 'com'), obs: fval(b, 'obs'), status: 'venda_realizada'
          };
          v.metaId = C.metaParaVenda(v);
          comOwner(v, ownerDoLead(lead, v.consultorId));
          const venda = Store.insert('vendas', v);
          transitionEtapa(lead, 'fechamento');
          Store.update('leads', lead.id, { vendaId: venda.id });
          Store.logHist(lead.id, 'venda', 'Venda registrada: ' + U.brl(cred) +
            (v.metaId ? ' — conta na meta "' + C.nomeMeta(v.metaId) + '"' : ''), Auth.currentId());
        });
        C.toast('Venda registrada! Dashboard, relatórios e metas atualizados.');
        if (after) after();
      }
    });
  };

  H.motivoForm = function (lead, after) {
    const b = buildForm(
      C.field('Motivo', '<select name="motivo">' + C.opts(Store.constants().MOTIVOS_PERDA, '') + '</select>') +
      C.field('Data', '<input type="date" name="data" value="' + U.todayISO() + '">') +
      C.field('Consultor', '<select name="cons">' + C.opts(C.usuariosConsultores(), lead.consultorId) + '</select>') +
      C.field('Observações', '<textarea name="obs"></textarea>', true)
    );
    C.modal('Marcar como "Não fez o consórcio"', b, {
      saveLabel: 'Confirmar', onSave: function () {
        Store.batch(function () {
          transitionEtapa(lead, 'nao_fez');
          Store.update('leads', lead.id, {
            motivoPerda: { motivo: fval(b, 'motivo'), data: fval(b, 'data'), consultorId: fval(b, 'cons'), obs: fval(b, 'obs') }
          });
          Store.logHist(lead.id, 'perda', 'Não fez o consórcio — ' + fval(b, 'motivo'), Auth.currentId());
        });
        C.toast('Lead mantido no histórico.');
        if (after) after();
      }
    });
  };

  H.contatoForm = function (lead, after) {
    const b = buildForm(
      C.field('O que foi conversado?', '<textarea name="txt"></textarea>', true) +
      (lead.etapa === 'novo' ? C.field('', '<label class="inline"><input type="checkbox" name="mv" checked> Mover para "Primeira Ligação"</label>', true) : '')
    );
    C.modal('Registrar contato', b, {
      saveLabel: 'Registrar', onSave: function () {
        const txt = fval(b, 'txt');
        if (!txt) { alert('Escreva um resumo do contato.'); return false; }
        Store.batch(function () {
          Store.logHist(lead.id, 'contato', txt, Auth.currentId());
          const mv = b.querySelector('[name="mv"]');
          if (mv && mv.checked) transitionEtapa(lead, 'primeira_ligacao');
        });
        C.toast('Contato registrado.');
        if (after) after();
      }
    });
  };

  H.moverEtapaForm = function (lead, after) {
    const b = buildForm(C.field('Nova etapa', '<select name="et">' +
      C.opts(Store.etapas().map(function (e) { return { value: e.key, label: e.label }; }), lead.etapa) + '</select>', true));
    C.modal('Mover etapa', b, {
      saveLabel: 'Mover', onSave: function () {
        const et = fval(b, 'et');
        if (et !== lead.etapa) { moveLead(lead.id, et); }
        if (after) after();
      }
    });
  };

  /* ---------------- indicador (quem indicou) ---------------- */
  function novoIndicadorInline(selectEl) {
    const b = buildForm(
      C.field('Nome de quem indicou', '<input name="nome">', true) +
      C.field('Telefone (opcional)', '<input name="tel">') +
      C.field('Observações (opcional)', '<input name="obs">')
    );
    C.modal('Cadastrar quem indicou', b, {
      saveLabel: 'Cadastrar', onSave: function () {
        const nome = fval(b, 'nome');
        if (!nome) { alert('Informe o nome.'); return false; }
        const ind = Store.insert('indicadores', { nome: nome, telefone: fval(b, 'tel'), obs: fval(b, 'obs') });
        const o = document.createElement('option');
        o.value = ind.id; o.textContent = nome;
        selectEl.appendChild(o); selectEl.value = ind.id;
      }
    });
  }

  /* ---------------- formulário do lead (novo / editar) ---------------- */
  function leadFormBody(lead) {
    lead = lead || {};
    const meuId = Auth.isConsultor() ? Auth.currentId() : (lead.consultorId || '');
    const inds = Store.all('indicadores').map(function (i) { return { value: i.id, label: i.nome }; });
    const b = buildForm(
      C.field('Nome *', '<input name="nome" value="' + U.esc(lead.nome || '') + '">', true) +
      C.field('Telefone', '<input name="tel" value="' + U.esc(lead.telefone || '') + '">') +
      C.field('WhatsApp', '<input name="wpp" value="' + U.esc(lead.whatsapp || '') + '">') +
      C.field('E-mail', '<input name="email" value="' + U.esc(lead.email || '') + '">') +
      C.field('Cidade', '<input name="cidade" value="' + U.esc(lead.cidade || '') + '">') +
      C.field('De onde veio esse lead?', '<select name="origem">' + C.opts(Store.config().origens, lead.origem || '', { blank: '—' }) + '</select>') +
      C.field('Consultor responsável', '<select name="cons"' + (Auth.isConsultor() ? ' disabled' : '') + '>' + C.opts(C.usuariosConsultores(), meuId, { blank: '—' }) + '</select>') +
      C.field('Observações', '<textarea name="obs">' + U.esc(lead.obs || '') + '</textarea>', true)
    );

    // linha dinâmica "Quem indicou?"
    const row = U.el('<div class="field full indicador-row" style="display:none"><span>Quem indicou esse cliente?</span>' +
      '<div class="inline-pick"><select name="indicador">' + C.opts(inds, lead.indicadorId || '', { blank: '— selecione —' }) + '</select>' +
      '<button type="button" class="btn ghost sm add-ind">+ Novo</button></div></div>');
    b.appendChild(row);
    row.querySelector('.add-ind').onclick = function () { novoIndicadorInline(row.querySelector('select')); };

    function sync() {
      row.style.display = b.querySelector('[name="origem"]').value === 'Indicação' ? 'flex' : 'none';
    }
    b.querySelector('[name="origem"]').addEventListener('change', sync);
    sync();
    return b;
  }

  function novoLeadForm(after) {
    const b = leadFormBody(null);
    C.modal('+ Novo lead', b, {
      saveLabel: 'Criar lead', onSave: function () {
        const nome = fval(b, 'nome');
        if (!nome) { alert('Informe ao menos o nome do lead.'); return false; }
        const origem = fval(b, 'origem');
        const indicadorId = origem === 'Indicação' ? (fval(b, 'indicador') || null) : null;
        const consId = Auth.isConsultor() ? Auth.currentId() : (fval(b, 'cons') || null);
        const lead = Store.insert('leads', comOwner({
          nome: nome, telefone: fval(b, 'tel'), whatsapp: fval(b, 'wpp'), email: fval(b, 'email'),
          cidade: fval(b, 'cidade'), origem: origem, indicadorId: indicadorId, consultorId: consId,
          obs: fval(b, 'obs'), etapa: 'novo', proximoContato: null, valorCredito: null,
          reuniao: null, proposta: null, motivoPerda: null, vendaId: null, atualizadoEm: U.nowISO()
        }, ownerNovoLead(consId)));
        Store.logHist(lead.id, 'cadastro',
          'Lead cadastrado. Origem: ' + (origem || '—') + (indicadorId ? '. Indicado por: ' + C.nomeIndicador(indicadorId) : ''),
          Auth.currentId());
        C.toast('Lead criado.');
        if (after) after(lead);
      }
    });
  }

  /* ---------------- ficha completa do lead ---------------- */
  function openLeadModal(id) {
    const lead = Store.get('leads', id);
    if (!lead) return;
    const st = statusLead(lead);
    const body = U.el('<div class="lead-modal"></div>');

    body.appendChild(U.el(
      '<div class="lead-head">' +
      C.chip(Store.etapaLabel(lead.etapa), 'st-info') + ' ' +
      C.chip(st.label, st.cls) + ' ' +
      (lead.origem ? C.chip(lead.origem, 'st-muted') : '') + ' ' +
      (lead.indicadorId ? C.chip('Indicado por: ' + C.nomeIndicador(lead.indicadorId), 'st-muted') : '') +
      '</div>'
    ));

    if (Auth.canEdit()) body.appendChild(quickActions(lead,
      function () { m.close(); openLeadModal(id); },   // reabrir (após ações que mantêm o lead)
      function () { m.close(); }));                    // fechar de vez (após excluir)

    const tabHost = U.el('<div class="tab-host"></div>');
    body.appendChild(tabHost);

    const m = C.modal(lead.nome || 'Lead', body, { wide: true });
    const reopen = function () { m.close(); openLeadModal(id); };

    C.tabs(tabHost, [
      { key: 'dados', label: 'Dados' },
      { key: 'hist', label: 'Histórico' },
      { key: 'sim', label: 'Simulações' },
      { key: 'prop', label: 'Propostas' }
    ], function (key) {
      let pane = tabHost.querySelector('.tabpane');
      if (!pane) { pane = U.el('<div class="tabpane"></div>'); tabHost.appendChild(pane); }
      pane.innerHTML = '';
      if (key === 'dados') dadosTab(pane, lead, reopen);
      if (key === 'hist') histTab(pane, lead);
      if (key === 'sim') simTab(pane, lead, reopen);
      if (key === 'prop') propTab(pane, lead, reopen);
    }, 'lead');
  }

  function quickActions(lead, reopen, closeModal) {
    const wrap = U.el('<div class="quick-actions"></div>');
    const mk = function (label, fn) { const btn = U.el('<button class="qa">' + label + '</button>'); btn.onclick = fn; wrap.appendChild(btn); };
    if (lead.telefone) wrap.appendChild(U.el('<a class="qa" href="' + U.telLink(lead.telefone) + '">📞 Ligar</a>'));
    if (lead.whatsapp || lead.telefone) wrap.appendChild(U.el('<a class="qa" target="_blank" href="' + U.waLink(lead.whatsapp || lead.telefone) + '">💬 WhatsApp</a>'));
    mk('📝 Registrar contato', function () { H.contatoForm(lead, reopen); });
    mk('📅 Agendar reunião', function () { H.reuniaoForm(lead, reopen); });
    mk('📄 Criar proposta', function () { H.propostaForm(lead, reopen); });
    mk('↔️ Mover etapa', function () { H.moverEtapaForm(lead, reopen); });
    if (lead.etapa !== 'fechamento') mk('✅ Fechar venda', function () { H.fecharVendaForm(lead, reopen); });
    if (lead.etapa !== 'nao_fez') mk('🚫 Não realizado', function () { H.motivoForm(lead, reopen); });

    const del = U.el('<button class="qa" style="color:#b3261e">🗑️ Excluir lead</button>');
    del.onclick = function () { confirmarExclusaoLead(lead, closeModal || reopen); };
    wrap.appendChild(del);
    return wrap;
  }

  /* ---------------- exclusão de lead (Supabase como fonte oficial) ----------------
     Padrão do CRM p/ escrita no Supabase (ver js/store.js):
       - leitura de leads .......... Store.all('leads') / Auth.scope(...)  (cache hidratado do Supabase)
       - criação de leads .......... Store.insert('leads', {...})  -> upsert em public.leads (id, data jsonb)
       - edição de leads ........... Store.update('leads', id, patch) -> upsert em public.leads
       - sincronização ............. fila serial no Store; cache reidratado por Store.hydrate()
       - auth/permissões ........... Auth.client() (sessão do usuário) + RLS is_agency_user(); telas gated por Auth.canEdit()
     Exclusão segue o mesmo caminho: DELETE em public.leads pelo ID original do lead,
     via Auth.client(), e só então o cache é ressincronizado a partir do servidor.

     HISTÓRICO: historico.leadId é apenas uma referência dentro do JSONB (índice
     idx_hist_lead em (data->>'leadId')). NÃO há chave estrangeira nem ON DELETE
     CASCADE no schema, e nenhum código do CRM exige remover o histórico junto com
     o lead. Por segurança, a exclusão apaga SOMENTE a linha de public.leads e
     mantém as linhas de public.historico. */
  function mensagemErroAmigavel(error) {
    const raw = (error && (error.message || error.hint || error.details || error.code)) || '';
    if (/permission|policy|rls|not authorized|denied|42501|403/i.test(raw)) return 'você não tem permissão para excluir este lead.';
    if (/network|failed to fetch|fetch|timeout|econn|dns/i.test(raw)) return 'sem conexão com o servidor. Tente novamente.';
    return raw ? ('detalhe técnico: ' + raw) : 'erro desconhecido ao contatar o servidor.';
  }

  function confirmarExclusaoLead(lead, afterOk) {
    const body = U.el('<div>' +
      '<p>Tem certeza que deseja excluir este lead?</p>' +
      '<p>Essa ação excluirá o lead do CRM e do banco de dados e não poderá ser desfeita.</p>' +
      '</div>');
    C.modal('Excluir lead', body, {
      saveLabel: 'EXCLUIR', cancelLabel: 'CANCELAR',
      onSave: function () { executarExclusaoLead(lead, afterOk); } // fecha o "confirmar"; o resultado vem por mensagem
    });
  }

  function executarExclusaoLead(lead, afterOk) {
    const mode = (Store._mode ? Store._mode() : 'local');

    /* Sem Supabase configurado neste ambiente: usa o caminho normal do CRM. */
    if (mode === 'local') {
      Store.remove('leads', lead.id);
      C.toast('Lead excluído.');
      if (afterOk) afterOk();
      return;
    }

    /* Supabase configurado, porém sessão/carregamento não OK: não exclui nada. */
    if (mode !== 'cloud') {
      C.toast('Sem conexão confirmada com o servidor. O lead não foi excluído. Tente novamente em instantes.');
      return;
    }

    const c = (window.Auth && typeof Auth.client === 'function') ? Auth.client() : null;
    if (!c) { C.toast('Não foi possível falar com o servidor. O lead não foi excluído.'); return; }

    /* DELETE real em public.leads pelo ID original — Supabase é a fonte oficial. */
    c.from('leads').delete().eq('id', lead.id).then(function (res) {
      if (res && res.error) {
        console.error('Erro ao excluir lead no Supabase:', res.error);
        C.toast('Não foi possível excluir o lead — ' + mensagemErroAmigavel(res.error));
        return; // lead permanece na lista e no cache
      }
      /* Sucesso no servidor -> agora sim tira do cache pelo mesmo caminho que o
         CRM já usa para excluir (Store.remove): a lista, os contadores e os
         filtros se atualizam sozinhos, sem recarregar a página. O DELETE que o
         Store enfileira é idempotente (a linha já não existe = sem efeito). */
      if (afterOk) afterOk();
      Store.remove('leads', lead.id);
      C.toast('Lead excluído com sucesso.');
    }, function (err) {
      console.error('Falha de rede ao excluir lead:', err);
      C.toast('Não foi possível excluir o lead — ' + mensagemErroAmigavel(err));
    });
  }

  function dadosTab(pane, lead, reopen) {
    const b = leadFormBody(lead);
    b.appendChild(U.el(C.field('Próximo contato', '<input type="date" name="prox" value="' + (lead.proximoContato || '') + '">')));
    pane.appendChild(b);
    if (lead.reuniao) {
      pane.appendChild(U.el('<div class="muted">Reunião: ' + U.fmtDate(lead.reuniao.data) + ' às ' + U.esc(lead.reuniao.hora || '') + ' · ' + C.nomeUsuario(lead.reuniao.consultorId) + '</div>'));
      if (lead.reuniao.realizada && lead.reuniao.observacao) {
        pane.appendChild(U.el('<div class="muted" style="white-space:pre-wrap">Observações da reunião: ' + U.esc(lead.reuniao.observacao) + '</div>'));
      }
    }
    if (lead.motivoPerda) pane.appendChild(U.el('<div class="muted">Motivo (não fez): ' + U.esc(lead.motivoPerda.motivo) + '</div>'));

    if (Auth.canEdit()) {
      const save = U.el('<button class="btn primary" style="margin-top:12px">Salvar dados</button>');
      save.onclick = function () {
        const nome = fval(b, 'nome');
        if (!nome) { alert('Informe o nome.'); return; }
        const origem = fval(b, 'origem');
        const novoConsId = Auth.isConsultor() ? lead.consultorId : (fval(b, 'cons') || null);
        const patch = {
          nome: nome, telefone: fval(b, 'tel'), whatsapp: fval(b, 'wpp'), email: fval(b, 'email'),
          cidade: fval(b, 'cidade'), origem: origem,
          indicadorId: origem === 'Indicação' ? (fval(b, 'indicador') || null) : null,
          consultorId: novoConsId,
          obs: fval(b, 'obs'), proximoContato: fval(b, 'prox') || null, atualizadoEm: U.nowISO()
        };
        /* reatribuição: o dono (owner_uid) acompanha o novo consultor, se ele já tiver login */
        const reatribuido = !Auth.isConsultor() && novoConsId !== lead.consultorId;
        if (reatribuido) {
          const ou = novoConsId && Store.ownerUidFor ? Store.ownerUidFor(novoConsId) : null;
          if (ou) patch.owner_uid = ou;
        }
        Store.update('leads', lead.id, patch);
        if (reatribuido) {
          Store.logHist(lead.id, 'reatribuicao',
            novoConsId ? 'Lead reatribuído para ' + C.nomeUsuario(novoConsId) : 'Lead sem consultor responsável',
            Auth.currentId());
        }
        C.toast('Dados salvos.');
        reopen();
      };
      pane.appendChild(save);
    } else {
      b.querySelectorAll('input,select,textarea').forEach(function (e) { e.disabled = true; });
    }
  }

  function histTab(pane, lead) {
    const items = Store.historyOf(lead.id);
    if (!items.length) { pane.appendChild(U.el('<div class="empty">Sem histórico.</div>')); return; }
    const tl = U.el('<div class="timeline"></div>');
    items.forEach(function (h) {
      tl.appendChild(U.el('<div class="tl-item"><div class="tl-date">' + U.fmtDateTime(h.data) + '</div>' +
        '<div class="tl-txt">' + U.esc(h.texto) + '<span class="muted"> — ' + C.nomeUsuario(h.usuarioId) + '</span></div></div>'));
    });
    pane.appendChild(tl);
  }

  function simTab(pane, lead, reopen) {
    if (Auth.canEdit()) {
      const add = U.el('<button class="btn primary sm">+ Nova simulação</button>');
      add.onclick = function () { simForm(lead, reopen); };
      pane.appendChild(add);
    }
    const sims = Store.all('simulacoes').filter(function (s) { return s.leadId === lead.id; });
    if (!sims.length) { pane.appendChild(U.el('<div class="empty">Nenhuma simulação.</div>')); return; }
    sims.forEach(function (s) {
      const card = U.el('<div class="mini-card"><b>' + U.brl(s.valorCredito) + '</b> em ' + (s.parcelas || '—') + 'x de ' + U.brl(s.valorParcela) +
        '<div class="muted">' + U.esc(s.administradora || '—') + (s.grupo ? ' · Grupo ' + U.esc(s.grupo) : '') + (s.cota ? ' · Cota ' + U.esc(s.cota) : '') +
        (s.lance ? ' · Lance ' + U.brl(s.lance) : '') + '</div>' +
        (s.obs ? '<div class="muted">' + U.esc(s.obs) + '</div>' : '') + '</div>');
      if (Auth.canEdit()) {
        const del = U.el('<button class="iconbtn">🗑️</button>');
        del.onclick = function () { C.confirm('Excluir simulação?', function () { Store.remove('simulacoes', s.id); reopen(); }); };
        card.appendChild(del);
      }
      pane.appendChild(card);
    });
  }

  function simForm(lead, reopen) {
    const b = buildForm(
      C.field('Valor do crédito (R$)', '<input name="cred" inputmode="decimal" value="' + (lead.valorCredito || '') + '">') +
      C.field('Qtd. de parcelas', '<input name="parcelas" inputmode="numeric">') +
      C.field('Valor da parcela (R$)', '<input name="parc" inputmode="decimal">') +
      C.field('Administradora', '<select name="adm">' + admOpts('') + '</select>') +
      C.field('Grupo', '<input name="grupo">') +
      C.field('Cota', '<input name="cota">') +
      C.field('Lance (R$)', '<input name="lance" inputmode="decimal">') +
      C.field('Lance (%)', '<input name="plance" inputmode="decimal">') +
      C.field('Prazo (meses)', '<input name="prazo" inputmode="numeric">') +
      C.field('Observações', '<textarea name="obs"></textarea>', true)
    );
    C.modal('Nova simulação', b, {
      saveLabel: 'Salvar', onSave: function () {
        Store.insert('simulacoes', comOwner({
          leadId: lead.id, consultorId: Auth.currentId() || lead.consultorId,
          valorCredito: fnum(b, 'cred'), parcelas: fnum(b, 'parcelas'), valorParcela: fnum(b, 'parc'),
          administradora: fval(b, 'adm'), grupo: fval(b, 'grupo'), cota: fval(b, 'cota'),
          lance: fnum(b, 'lance'), percentualLance: fnum(b, 'plance'), prazo: fnum(b, 'prazo'), obs: fval(b, 'obs')
        }, ownerDoLead(lead, Auth.currentId())));
        Store.logHist(lead.id, 'simulacao', 'Simulação: ' + U.brl(fnum(b, 'cred')), Auth.currentId());
        C.toast('Simulação salva.');
        if (reopen) reopen();
      }
    });
  }

  function propTab(pane, lead, reopen) {
    if (Auth.canEdit()) {
      const add = U.el('<button class="btn primary sm">+ Nova proposta</button>');
      add.onclick = function () { H.propostaForm(lead, reopen); };
      pane.appendChild(add);
    }
    const props = Store.all('propostas').filter(function (p) { return p.leadId === lead.id; });
    if (!props.length) { pane.appendChild(U.el('<div class="empty">Nenhuma proposta.</div>')); return; }
    const L = Store.constants().LABEL_PROPOSTA;
    props.forEach(function (p) {
      const card = U.el('<div class="mini-card"><b>' + U.brl(p.valorCredito) + '</b> · parcela ' + U.brl(p.valorParcela) +
        '<div class="muted">' + U.esc(p.administradora || '—') + ' · ' + U.fmtDate(p.data) + '</div></div>');
      const selWrap = U.el('<div></div>');
      if (Auth.canEdit()) {
        const sel = U.el('<select class="sm">' + C.opts(Store.constants().STATUS_PROPOSTA.map(function (s) { return { value: s, label: L[s] }; }), p.status) + '</select>');
        sel.onchange = function () { Store.update('propostas', p.id, { status: sel.value }); C.toast('Status atualizado.'); };
        selWrap.appendChild(sel);
      } else {
        selWrap.appendChild(U.el(C.chip(L[p.status] || p.status)));
      }
      card.appendChild(selWrap);
      pane.appendChild(card);
    });
  }

  /* Data/horário da reunião já armazenados em lead.reuniao ({ data:'AAAA-MM-DD', hora:'HH:MM', ... }).
     Retorna "" quando não há nada; "DD/MM/AAAA às HH:MM", só a data ou só o horário conforme o que existir. */
  function reuniaoLinha(lead) {
    const r = lead.reuniao || {};
    const d = r.data ? U.fmtDate(r.data) : '';
    const h = r.hora ? String(r.hora).trim() : '';
    const dOk = d && d !== '—';
    if (dOk && h) return d + ' às ' + h;
    return dOk ? d : h;
  }

  /* ---------------- cartão do lead (funil) ---------------- */
  function leadCard(lead) {
    const showReuniao = (lead.etapa === 'reuniao_agendada' || lead.etapa === 'reuniao_realizada') && reuniaoLinha(lead);
    const card = U.el('<div class="lead-card" tabindex="0">' +
      '<div class="lc-name">' + U.esc(lead.nome) + '</div>' +
      (showReuniao ? '<div class="lc-line muted">📅 ' + U.esc(reuniaoLinha(lead)) + '</div>' : '') +
      (lead.telefone ? '<div class="lc-line">📞 ' + U.esc(U.fmtPhone(lead.telefone)) + '</div>' : '') +
      '<div class="lc-line">👤 ' + U.esc(C.nomeUsuario(lead.consultorId)) + '</div>' +
      (lead.valorCredito ? '<div class="lc-line">💰 ' + U.brlShort(lead.valorCredito) + '</div>' : '') +
      (lead.proximoContato ? '<div class="lc-line">⏰ ' + U.fmtDate(lead.proximoContato) + '</div>' : '') +
      (lead.origem ? '<div class="lc-tag">' + U.esc(lead.origem) + '</div>' : '') +
      (lead.indicadorId ? '<div class="lc-line muted">Indicado por: ' + U.esc(C.nomeIndicador(lead.indicadorId)) + '</div>' : '') +
      '</div>');
    card.onclick = function () { openLeadModal(lead.id); };
    card.onkeydown = function (e) { if (e.key === 'Enter') openLeadModal(lead.id); };
    if (Auth.canEdit()) {
      /* botão "mover" — funciona no toque (iPad) onde arrastar não funciona */
      const mv = U.el('<button class="lc-move" title="Mover para outra etapa">⇄</button>');
      mv.onclick = function (e) { e.stopPropagation(); H.moverEtapaForm(lead); };
      card.appendChild(mv);

      /* arrastar-e-soltar (mouse/desktop) */
      card.draggable = true;
      card.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', lead.id);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(function () { card.classList.add('dragging'); }, 0);
      });
      card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
    }
    return card;
  }

  /* ================= VIEW: FUNIL ================= */
  Views.funil = function (container) {
    const head = U.el('<div class="page-head"><h1 class="page-title">Funil de Leads</h1></div>');
    if (Auth.canEdit()) {
      const add = U.el('<button class="btn primary">+ Novo lead</button>');
      add.onclick = function () { novoLeadForm(); };
      head.appendChild(add);
    }
    container.appendChild(head);

    const leads = scopedLeads();
    const board = U.el('<div class="kanban"></div>');
    Store.etapas().forEach(function (et) {
      const col = U.el('<div class="kanban-col" data-etapa="' + et.key + '">' +
        '<div class="kanban-col-head"><span>' + et.label + '</span><span class="cnt">0</span></div>' +
        '<div class="kanban-list"></div></div>');
      const list = col.querySelector('.kanban-list');
      const arr = leads.filter(function (l) { return l.etapa === et.key; })
        .sort(function (a, b) { return (b.atualizadoEm || b.criadoEm || '') < (a.atualizadoEm || a.criadoEm || '') ? -1 : 1; });
      col.querySelector('.cnt').textContent = arr.length + (arr.length === 1 ? ' lead' : ' leads');
      arr.forEach(function (l) { list.appendChild(leadCard(l)); });

      if (Auth.canEdit()) {
        col.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('drop'); });
        col.addEventListener('dragleave', function (e) { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); });
        col.addEventListener('drop', function (e) {
          e.preventDefault(); col.classList.remove('drop');
          const lid = e.dataTransfer.getData('text/plain');
          if (lid) moveLead(lid, et.key);
        });
      }
      board.appendChild(col);
    });
    container.appendChild(board);
    container.appendChild(U.el('<div class="muted">Arraste os cartões entre as colunas para mudar a etapa. No celular, abra o cartão e use "Mover etapa".</div>'));
  };

  /* ================= VIEW: LEADS (lista) ================= */
  Views.leads = function (container) {
    const head = U.el('<div class="page-head"><h1 class="page-title">Leads</h1></div>');
    if (Auth.canEdit()) {
      const add = U.el('<button class="btn primary">+ NOVO LEAD</button>');
      add.onclick = function () { novoLeadForm(); };
      head.appendChild(add);
    }
    container.appendChild(head);

    const f = U.el('<div class="filters">' +
      '<select id="f-origem"><option value="">Origem: todas</option>' + C.opts(Store.config().origens, '') + '</select>' +
      '<select id="f-ind" style="display:none"><option value="">Indicado por: todos</option>' +
      C.opts(Store.all('indicadores').map(function (i) { return { value: i.id, label: i.nome }; }), '') + '</select>' +
      '<select id="f-cons"><option value="">Consultor: todos</option>' + C.opts(C.usuariosConsultores(), '') + '</select>' +
      '<select id="f-etapa"><option value="">Etapa: todas</option>' + C.opts(Store.etapas().map(function (e) { return { value: e.key, label: e.label }; }), '') + '</select>' +
      '<select id="f-status"><option value="">Status: todos</option><option value="atend">Em atendimento</option><option value="cliente">Cliente</option><option value="perdido">Não realizado</option></select>' +
      '<input id="f-cidade" placeholder="Cidade">' +
      '<input id="f-de" type="date" title="Entrada de"><input id="f-ate" type="date" title="Entrada até">' +
      '</div>');
    container.appendChild(f);
    const tableWrap = U.el('<div class="card table-wrap"></div>');
    container.appendChild(tableWrap);

    function syncIndFilter() {
      f.querySelector('#f-ind').style.display = f.querySelector('#f-origem').value === 'Indicação' ? '' : 'none';
    }

    function draw() {
      syncIndFilter();
      const fo = f.querySelector('#f-origem').value, fi = f.querySelector('#f-ind').value,
        fc = f.querySelector('#f-cons').value, fe = f.querySelector('#f-etapa').value,
        fs = f.querySelector('#f-status').value, fcid = f.querySelector('#f-cidade').value.toLowerCase().trim(),
        fde = f.querySelector('#f-de').value, fate = f.querySelector('#f-ate').value;

      const rows = scopedLeads().filter(function (l) {
        if (fo && l.origem !== fo) return false;
        if (fi && l.indicadorId !== fi) return false;
        if (fc && l.consultorId !== fc) return false;
        if (fe && l.etapa !== fe) return false;
        if (fcid && (l.cidade || '').toLowerCase().indexOf(fcid) < 0) return false;
        const d = (l.criadoEm || '').slice(0, 10);
        if (fde && d < fde) return false;
        if (fate && d > fate) return false;
        if (fs) {
          const s = statusLead(l);
          if (fs === 'perdido' && s.label !== 'Não realizado') return false;
          if (fs === 'cliente' && s.label !== 'Cliente') return false;
          if (fs === 'atend' && !(s.label === 'Em atendimento' || s.label === 'Novo')) return false;
        }
        return true;
      }).sort(function (a, b) { return (b.criadoEm || '') < (a.criadoEm || '') ? -1 : 1; });

      tableWrap.innerHTML =
        '<table class="table"><thead><tr><th>Nome</th><th>Telefone</th><th>Origem</th><th>Indicado por</th>' +
        '<th>Consultor</th><th>Etapa</th><th>Cidade</th><th>Entrada</th><th>Status</th></tr></thead><tbody>' +
        rows.map(function (l) {
          const s = statusLead(l);
          return '<tr data-id="' + l.id + '"><td>' + U.esc(l.nome) + '</td><td>' + U.esc(U.fmtPhone(l.telefone)) + '</td>' +
            '<td>' + U.esc(l.origem || '—') + '</td><td>' + (l.indicadorId ? U.esc(C.nomeIndicador(l.indicadorId)) : '—') + '</td>' +
            '<td>' + U.esc(C.nomeUsuario(l.consultorId)) + '</td><td>' + Store.etapaLabel(l.etapa) + '</td>' +
            '<td>' + U.esc(l.cidade || '—') + '</td><td>' + U.fmtDate(l.criadoEm) + '</td>' +
            '<td>' + C.chip(s.label, s.cls) + '</td></tr>';
        }).join('') +
        '</tbody></table>' + (rows.length ? '' : '<div class="empty">Nenhum lead encontrado.</div>');

      tableWrap.querySelectorAll('tr[data-id]').forEach(function (tr) {
        tr.onclick = function () { openLeadModal(tr.dataset.id); };
      });
    }
    f.querySelectorAll('select,input').forEach(function (e) { e.addEventListener('change', draw); e.addEventListener('keyup', draw); });
    draw();
  };

  /* exporta o que outras telas precisam */
  Views._lead = {
    openModal: openLeadModal,
    novoLead: novoLeadForm,
    simForm: simForm,
    propostaForm: function (lead, after) { return H.propostaForm(lead, after); },
    fecharVenda: function (lead, after) { return H.fecharVendaForm(lead, after); },
    statusLead: statusLead
  };
})();
