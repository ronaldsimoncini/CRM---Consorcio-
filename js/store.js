/* Camada de dados do CRM.

   Migração para o Supabase — separação estrita de modos:

     'local'         -> O Supabase NÃO está configurado neste ambiente.
                        O localStorage é o banco. Comportamento clássico do CRM.

     'cloud'         -> Supabase configurado + sessão autenticada + hidratação OK.
                        Todas as leituras vêm do cache; as gravações vão para o
                        servidor por uma fila serial. O localStorage do CRM NÃO
                        é lido nem escrito.

     'cloud-pending' -> Supabase configurado, ainda sem sessão (tela de login).
                        Cache vazio (defaults). Nenhuma gravação é aceita.

     'error'         -> Supabase configurado + sessão, mas a hidratação FALHOU
                        (rede, RLS, tabela inexistente, erro do banco, etc).
                        O CRM fica CLARAMENTE em modo de erro: cache vazio, NENHUM
                        dado antigo do localStorage é carregado como se fosse atual,
                        e NENHUMA gravação é aceita (não dá impressão de "salvo").

   Regra de ouro: se o Supabase está configurado, o CRM nunca "cai" silenciosamente
   para o localStorage. Ou está em 'cloud', ou está visivelmente em 'error'.

   A API pública do Store continua IGUAL (mesmos nomes/assinaturas, leituras
   síncronas, escritas com retorno síncrono) — nenhuma view precisa mudar.

   Coleções: usuarios, produtos, indicadores, leads, simulacoes, propostas,
   metas, vendas, historico + config.
   `consultores` continua existindo APENAS no cache, por compatibilidade. */
window.Store = (function () {
  const KEY = 'crm_consorcio_v1';
  const subs = [];

  const DEFAULT_ORIGENS = ['Instagram', 'WhatsApp', 'Facebook', 'Google', 'Site', 'Tráfego pago', 'Indicação', 'Prospecção', 'Evento', 'Outro'];
  const DEFAULT_ADMINS = ['Porto', 'Itaú', 'Âncora', 'HS Consórcios', 'Embracon', 'Rodobens', 'Servopa', 'Bancorbrás'];
  const ETAPAS = [
    { key: 'novo', label: 'NOVO' },
    { key: 'primeira_ligacao', label: 'PRIMEIRA LIGAÇÃO' },
    { key: 'reuniao_agendada', label: 'REUNIÃO AGENDADA' },
    { key: 'reuniao_realizada', label: 'REUNIÃO REALIZADA' },
    { key: 'proposta_realizada', label: 'PROPOSTA REALIZADA' },
    { key: 'fechamento', label: 'FECHAMENTO' },
    { key: 'nao_fez', label: 'NÃO FEZ O CONSÓRCIO' },
    { key: 'retomar_contato', label: 'RETOMAR CONTATO' }
  ];
  /* Qualificação do Lead — classificação SEMPRE manual (nenhuma regra automática
     define/altera este campo). Exatamente 3 níveis; lead pode ficar sem nenhum
     (chave ausente/null). Guardado em leads.data.qualificacao. */
  const QUALIFICACOES = [
    { key: 'quente', label: '🔴 Lead quente', cls: 'ql-quente' },
    { key: 'morno', label: '🟠 Lead morno', cls: 'ql-morno' },
    { key: 'futuro', label: '🔵 Lead futuro', cls: 'ql-futuro' }
  ];
  const MOTIVOS_PERDA = ['Não teve interesse', 'Valor da parcela', 'Preferiu esperar', 'Não conseguiu aprovação', 'Comprou outra opção', 'Sem retorno', 'Outro'];
  const STATUS_PROPOSTA = ['rascunho', 'enviada', 'em_analise', 'negociacao', 'aprovada', 'recusada', 'cancelada'];
  const LABEL_PROPOSTA = {
    rascunho: 'Rascunho', enviada: 'Enviada', em_analise: 'Em análise', negociacao: 'Negociação',
    aprovada: 'Aprovada', recusada: 'Recusada', cancelada: 'Cancelada'
  };

  /* coleções que existem como tabela no Supabase (config é tratada à parte) */
  const COLLECTIONS = ['usuarios', 'produtos', 'indicadores', 'leads', 'simulacoes', 'propostas', 'metas', 'vendas', 'historico', 'reunioes'];

  /* tabelas que ganharam a coluna owner_uid na Fase 1 (dono do registro, fora do JSONB) */
  const OWNED = ['leads', 'simulacoes', 'propostas', 'metas', 'vendas', 'historico', 'reunioes'];

  /* coleções cuja tabela pode ainda NÃO existir no Supabase: um erro no select
     dela não derruba o CRM — vira [] e segue (ver hydrate). */
  const SOFT = ['reunioes'];

  let _batch = 0, _dirty = false;

  /* ---------- estado de modo ---------- */
  let _mode = 'cloud-pending';      // 'local' | 'cloud' | 'cloud-pending' | 'error'
  let _lastError = null;
  let _hydrated = false;
  let _hydrateToken = 0;            // invalida hidratações concorrentes (última vence)
  let _retryTimer = null;
  let _queue = Promise.resolve();   // fila serial de gravações no Supabase
  let _resolveReady, _readyResolved = false;
  const _readyPromise = new Promise(function (r) { _resolveReady = r; });

  /* Cache em memória — mesma estrutura de sempre. Começa VAZIO: só é populado
     pela hidratação (que decide entre localStorage e Supabase). Assim um usuário
     de nuvem nunca chega a ver dados do localStorage antigo. */
  let data = blank();

  function blank() {
    return {
      usuarios: [], consultores: [], produtos: [], leads: [], indicadores: [],
      simulacoes: [], propostas: [], vendas: [], metas: [], historico: [], reunioes: [],
      config: { empresa: 'LFT Consórcios', origens: DEFAULT_ORIGENS.slice(), administradoras: DEFAULT_ADMINS.slice(), painelTokens: [], etapasCustom: [], etapasOrdem: [] },
      _seeded: false, _v: 2
    };
  }

  /* Lê o localStorage do CRM. SÓ é chamada no modo 'local'. */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) { const d = blank(); return seedInto(d); }
      return migrate(Object.assign(blank(), JSON.parse(raw)));
    } catch (e) {
      console.warn('Erro ao ler dados salvos; recomeçando.', e);
      return seedInto(blank());
    }
  }

  /* Garante estrutura mínima ao abrir dados de versões anteriores (modo local). */
  function migrate(d) {
    normalize(d);

    /* consultores das versões antigas viram usuários (nível consultor), preservando o id */
    d.consultores.forEach(function (c) {
      if (!d.usuarios.some(function (u) { return u.id === c.id; })) {
        d.usuarios.push({
          id: c.id, nome: c.nome, email: c.email || '', senha: '123456', telefone: c.telefone || '',
          cargo: 'Consultor', nivel: 'consultor', status: (c.ativo === false ? 'inativo' : 'ativo'),
          criadoEm: c.criadoEm || U.nowISO(), ultimoAcesso: null
        });
      }
    });

    /* precisa existir sempre um administrador */
    if (!d.usuarios.some(function (u) { return u.nivel === 'admin'; })) {
      d.usuarios.unshift({
        id: U.uid(), nome: 'Administrador', email: 'relacionamento@lftgestaoderisco.com.br',
        senha: 'admin123', telefone: '', cargo: 'Administrador', nivel: 'admin', status: 'ativo',
        criadoEm: U.nowISO(), ultimoAcesso: null
      });
    }
    if (!d.produtos.length) {
      ['Imóvel', 'Veículo', 'Moto', 'Serviços', 'Pesados'].forEach(function (nome) {
        d.produtos.push({ id: U.uid(), nome: nome, ativo: true, criadoEm: U.nowISO() });
      });
    }
    d._v = 2;
    return d;
  }

  /* Normalização leve, usada também na nuvem: só garante arrays e campos de config.
     NUNCA injeta admin/produtos padrão — na nuvem o servidor é a fonte da verdade. */
  function normalize(d) {
    d.config = d.config || {};
    if (!d.config.empresa) d.config.empresa = 'LFT Consórcios';
    if (!d.config.origens || !d.config.origens.length) d.config.origens = DEFAULT_ORIGENS.slice();
    if (!d.config.administradoras || !d.config.administradoras.length) d.config.administradoras = DEFAULT_ADMINS.slice();
    if (!Array.isArray(d.config.painelTokens)) d.config.painelTokens = [];
    if (!Array.isArray(d.config.etapasCustom)) d.config.etapasCustom = [];
    if (!Array.isArray(d.config.etapasOrdem)) d.config.etapasOrdem = [];
    ['usuarios', 'consultores', 'produtos', 'leads', 'indicadores', 'simulacoes', 'propostas', 'vendas', 'metas', 'historico', 'reunioes']
      .forEach(function (k) { if (!Array.isArray(d[k])) d[k] = []; });
    return d;
  }

  function seedInto(d) {
    migrate(d);
    d._seeded = true;
    return d;
  }

  /* ---------- conversão linha do banco <-> objeto das views ---------- */
  /* Banco: { id, [owner_uid], [auth_uid], data:{...} }   |   Views: { id, ...data, [owner_uid], [authUid] }
     owner_uid e auth_uid são COLUNAS reais — nunca entram no JSONB. */
  function rowToObj(row) {
    const o = Object.assign({ id: row.id }, row.data || {});
    if (row.owner_uid != null) o.owner_uid = row.owner_uid;
    if (row.auth_uid != null) o.authUid = row.auth_uid;   // só em usuarios
    return o;
  }
  function objToRow(obj, k) {
    const ownedTable = OWNED.indexOf(k) >= 0;
    const row = { id: obj.id, data: {} };
    Object.keys(obj).forEach(function (key) {
      if (key === 'id' || key === 'authUid') return;      // authUid espelha a coluna auth_uid (somente leitura no app)
      if (key === 'owner_uid') {
        if (ownedTable && obj[key] != null) row.owner_uid = obj[key]; // vira coluna; descartado se a tabela não tem owner_uid
        return;
      }
      row.data[key] = obj[key];
    });
    return JSON.parse(JSON.stringify(row)); // snapshot: imune a mutações posteriores no cache
  }

  /* Fase 2: descobre o auth.uid() de um usuário (consultor) a partir do cache.
     Devolve null se o usuário ainda não tem login no Supabase (auth_uid nulo). */
  function ownerUidFor(usuarioId) {
    if (!usuarioId) return null;
    const u = data.usuarios.find(function (x) { return x.id === usuarioId; });
    return (u && u.authUid) || null;
  }

  /* ---------- avisos ao usuário ---------- */
  function toast(msg) {
    try {
      if (window.C && typeof window.C.toast === 'function') { window.C.toast(msg); return; }
    } catch (e) { /* ignora */ }
    console.warn('[Store]', msg);
  }

  function sbClient() {
    try { return (window.Auth && typeof window.Auth.client === 'function') ? window.Auth.client() : null; }
    catch (e) { return null; }
  }
  function sbUser() {
    try { return (window.Auth && typeof window.Auth.user === 'function') ? window.Auth.user() : null; }
    catch (e) { return null; }
  }

  function finishReady() {
    _hydrated = true;
    if (!_readyResolved) { _readyResolved = true; try { _resolveReady(_mode); } catch (e) { /* noop */ } }
  }

  /* ---------- hidratação ---------- */
  async function hydrate() {
    const my = ++_hydrateToken;

    try {
      if (window.Auth && typeof window.Auth.ready === 'function') await window.Auth.ready();
    } catch (e) { console.error('Auth.ready() falhou:', e); }
    if (my !== _hydrateToken) return _mode;

    const c = sbClient();

    /* ===== MODO LOCAL — Supabase não configurado neste ambiente ===== */
    if (!c) {
      _mode = 'local';
      _lastError = null;
      data = load();                 // ÚNICO ponto que lê o localStorage do CRM
      finishReady();
      emit();
      return _mode;
    }

    /* ===== Supabase configurado — daqui em diante é família CLOUD ===== */
    /* (o localStorage do CRM não é tocado em nenhum caminho abaixo) */
    const u = sbUser();
    if (!u) {
      _mode = 'cloud-pending';        // tela de login; usa apenas config().empresa
      _lastError = null;
      data = blank();
      finishReady();
      emit();
      return _mode;
    }

    try {
      const fresh = blank();

      const results = await Promise.all(
        COLLECTIONS.map(function (k) {
          var cols = 'id, data';
          if (k === 'usuarios') cols = 'id, auth_uid, data';
          else if (OWNED.indexOf(k) >= 0) cols = 'id, owner_uid, data';
          return c.from(k).select(cols);
        })
      );
      if (my !== _hydrateToken) return _mode;

      COLLECTIONS.forEach(function (k, i) {
        const res = results[i];
        if (res.error) {
          if (SOFT.indexOf(k) >= 0) {
            console.warn('[Store] coleção "' + k + '" indisponível (' + res.error.message + ') — seguindo com lista vazia.');
            fresh[k] = [];
            return;
          }
          throw new Error(k + ': ' + res.error.message);
        }
        fresh[k] = (res.data || []).map(rowToObj);
      });

      const cfgRes = await c.from('config').select('data').eq('id', 1).maybeSingle();
      if (my !== _hydrateToken) return _mode;
      if (cfgRes.error) throw new Error('config: ' + cfgRes.error.message);
      fresh.config = Object.assign(blank().config, (cfgRes.data && cfgRes.data.data) || {});

      fresh.consultores = [];  // compatibilidade: não há tabela; fica só no cache
      fresh._seeded = false;

      data = normalize(fresh);
      _mode = 'cloud';
      _lastError = null;
      if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
      finishReady();
      emit();
    } catch (e) {
      if (my !== _hydrateToken) return _mode;
      console.error('Falha ao carregar os dados do Supabase (modo de erro):', e);
      _mode = 'error';
      _lastError = e;
      data = blank();                 // NÃO carrega localStorage: dados antigos não entram como se fossem atuais
      finishReady();
      toast('Não foi possível carregar os dados do servidor. O CRM está em MODO DE ERRO — nada será salvo até a conexão voltar. Recarregue a página para tentar novamente.');
      scheduleRetry();
      emit();
    }
    return _mode;
  }

  /* Enquanto estiver em erro, tenta re-hidratar sozinho de tempos em tempos. */
  function scheduleRetry() {
    if (_retryTimer) return;
    _retryTimer = setTimeout(function () {
      _retryTimer = null;
      if (_mode === 'error') {
        toast('Tentando reconectar ao servidor…');
        hydrate();
      }
    }, 20000);
  }

  /* Zera o cache. Usado no logout, antes de re-hidratar para o próximo usuário. */
  function clear() {
    data = blank();
    _hydrated = false;
    _mode = sbClient() ? 'cloud-pending' : 'local';
    emit();
  }

  function ready() { return _readyPromise; }

  /* ---------- fila serial de gravações no Supabase ---------- */
  function enqueue(taskFn) {
    _queue = _queue.then(function () { return taskFn(); }).catch(function (e) {
      console.error('Erro ao gravar no Supabase:', e);
      toast('Falha ao salvar no servidor: ' + (e && e.message || e) + '. Recarregando os dados do servidor…');
      /* cache otimista pode ter divergido — re-sincroniza (pode ir para modo de erro) */
      hydrate();
    });
    return _queue;
  }
  function serverError(res) { if (res && res.error) throw new Error(res.error.message || 'erro desconhecido'); return res; }

  function pushUpsert(k, row) {
    if (_mode !== 'cloud') return;
    const c = sbClient(); if (!c) return;
    enqueue(function () { return c.from(k).upsert(row).then(serverError); });
  }
  function pushDelete(k, id) {
    if (_mode !== 'cloud') return;
    const c = sbClient(); if (!c) return;
    enqueue(function () { return c.from(k).delete().eq('id', id).then(serverError); });
  }

  /* Bloqueia qualquer gravação fora de 'local'/'cloud'. Lança erro (a operação
     NÃO acontece nem no cache) para não dar a impressão de que foi salva. */
  function assertWritable() {
    if (_mode === 'local' || _mode === 'cloud') return;
    const msg = (_mode === 'error')
      ? 'O CRM está em modo de erro (sem conexão com o servidor). A alteração NÃO foi salva.'
      : 'Sessão ainda não confirmada com o servidor. Entre novamente para salvar as alterações.';
    toast(msg);
    throw new Error('[Store] gravação bloqueada — modo "' + _mode + '". ' + msg);
  }

  /* ---------- persistência local / notificação ---------- */
  function emit() { subs.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } }); }

  /* Grava no localStorage SOMENTE no modo 'local'. Notifica os assinantes sempre. */
  function flush() {
    if (_batch > 0) { _dirty = true; return; }
    if (_mode === 'local') {
      try { localStorage.setItem(KEY, JSON.stringify(data)); }
      catch (e) { console.error('Falha ao salvar no localStorage:', e); }
    }
    emit();
  }
  function batch(fn) {
    _batch++;
    try { fn(); } finally {
      _batch--;
      if (_batch === 0 && _dirty) { _dirty = false; flush(); }
    }
  }
  function subscribe(fn) { subs.push(fn); }

  /* ---------- leitura (síncrona, sempre do cache) ---------- */
  function all(k) { return data[k].slice(); }
  function get(k, id) { return data[k].find(function (x) { return x.id === id; }); }
  function config() { return data.config; }
  /* Etapas fixas (com comportamento especial em views-leads.js) + etapas
     customizadas pelo usuário, guardadas em config.data.etapasCustom
     ([{key,label}], mesmo padrão de origens/administradoras). As custom
     entram sempre no fim da lista e nunca substituem/alteram as fixas —
     nenhuma migração de leads existentes é necessária. */
  /* A ordem de exibição vem de config.data.etapasOrdem (array de keys). Keys
     fora dessa lista (ex.: etapa recém-criada) ficam no fim; keys da lista que
     não existem mais são ignoradas. Sem etapasOrdem: fixas + custom, como antes. */
  function etapas() {
    const base = ETAPAS.concat(data.config.etapasCustom || []);
    const ordem = data.config.etapasOrdem;
    if (!Array.isArray(ordem) || !ordem.length) return base;
    const porKey = {}, usada = {}, out = [];
    base.forEach(function (e) { porKey[e.key] = e; });
    ordem.forEach(function (k) { if (porKey[k] && !usada[k]) { usada[k] = true; out.push(porKey[k]); } });
    base.forEach(function (e) { if (!usada[e.key]) out.push(e); });
    return out;
  }
  function etapaLabel(key) { const e = etapas().find(function (x) { return x.key === key; }); return e ? e.label : key; }

  /* Gera uma key única (slug) para uma nova etapa a partir do nome digitado,
     evitando colisão com as etapas fixas e com as já cadastradas. */
  function slugEtapa(nome) {
    let base = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!base) base = 'etapa';
    const existentes = etapas().map(function (e) { return e.key; });
    let key = base, n = 2;
    while (existentes.indexOf(key) >= 0) { key = base + '_' + n; n++; }
    return key;
  }

  /* Proteção na função (não só na interface): só administrador altera o funil. */
  function assertAdminEtapas() {
    if (!(window.Auth && typeof Auth.isAdmin === 'function' && Auth.isAdmin())) {
      throw new Error('Apenas administradores podem alterar as etapas do funil.');
    }
  }

  /* ---------- administração das etapas (somente administrador) ---------- */
  function isEtapaCustom(key) {
    return (data.config.etapasCustom || []).some(function (e) { return e.key === key; }) &&
      !ETAPAS.some(function (e) { return e.key === key; });
  }

  /* Etapas sem comportamento especial (as únicas aceitas como destino de exclusão em massa):
     as originais "novo" e "primeira_ligacao" + todas as customizadas. */
  function etapasGenericas() {
    return etapas().filter(function (e) { return e.key === 'novo' || e.key === 'primeira_ligacao' || isEtapaCustom(e.key); });
  }

  function limparNome(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function nomeNormalizado(s) { return limparNome(s).toLocaleLowerCase('pt-BR'); }
  function assertNomeEtapaLivre(label, exceptKey) {
    const n = nomeNormalizado(label);
    if (!n) throw new Error('Informe o nome da etapa.');
    if (n === 'sem etapa') throw new Error('Esse nome é reservado. Escolha outro nome.');
    if (etapas().some(function (e) { return e.key !== exceptKey && nomeNormalizado(e.label) === n; })) {
      throw new Error('Já existe uma etapa com esse nome.');
    }
  }

  function reordenarEtapas(keys) {
    assertAdminEtapas();
    assertWritable();
    const atuais = etapas().map(function (e) { return e.key; });
    if (!Array.isArray(keys) || keys.length !== atuais.length ||
        keys.some(function (k, i) { return atuais.indexOf(k) < 0 || keys.indexOf(k) !== i; })) {
      throw new Error('Ordem de etapas inválida.');
    }
    setConfig({ etapasOrdem: keys.slice() });
  }

  /* depoisDeKey (opcional): key da etapa após a qual a nova será inserida; vazio = no final.
     etapasCustom e etapasOrdem são gravadas numa única operação. */
  function addEtapaCustom(nome, depoisDeKey) {
    assertAdminEtapas();
    assertWritable();
    const label = limparNome(nome);
    assertNomeEtapaLivre(label, null);
    const key = slugEtapa(label);
    const nova = { key: key, label: label.toUpperCase() };
    const patch = { etapasCustom: (data.config.etapasCustom || []).concat([nova]) };
    if (depoisDeKey) {
      const ordem = etapas().map(function (e) { return e.key; });
      const i = ordem.indexOf(depoisDeKey);
      if (i < 0) throw new Error('Posição inválida: a etapa de referência não existe mais.');
      ordem.splice(i + 1, 0, key);
      patch.etapasOrdem = ordem;
    }
    setConfig(patch);
    return nova;
  }

  /* Só altera o label visual; a key, a ordem e os leads ficam intactos. */
  function renomearEtapaCustom(key, novoNome) {
    assertAdminEtapas();
    assertWritable();
    if (!isEtapaCustom(key)) throw new Error('Somente etapas customizadas podem ser renomeadas.');
    const label = limparNome(novoNome);
    assertNomeEtapaLivre(label, key);
    setConfig({
      etapasCustom: (data.config.etapasCustom || []).map(function (e) {
        return e.key === key ? Object.assign({}, e, { label: label.toUpperCase() }) : e;
      })
    });
  }

  let _excluindoEtapa = false;

  /* Exclui uma etapa CUSTOMIZADA. Se houver leads nela, exige um destino genérico e os move
     (sem apagar nenhum lead; histórico preservado + nova linha de histórico por lead).
     Na nuvem, os leads e o histórico vão em requisições únicas e AGUARDADAS; a etapa só sai
     da configuração depois que elas confirmam. Se algo falhar, nada é excluído. */
  async function excluirEtapaCustom(key, destinoKey) {
    assertAdminEtapas();
    assertWritable();
    if (!isEtapaCustom(key)) throw new Error('Somente etapas customizadas podem ser excluídas.');
    if (_excluindoEtapa) throw new Error('Já existe uma exclusão de etapa em andamento.');
    _excluindoEtapa = true;
    try {
      const c = (_mode === 'cloud') ? sbClient() : null;
      if (_mode === 'cloud') {
        await _queue;                                   // aguarda gravações pendentes
        await hydrate();                                // dados frescos do servidor (pega leads de outros usuários)
        if (_mode !== 'cloud') throw new Error('Não foi possível confirmar os dados com o servidor. Nada foi excluído.');
        assertAdminEtapas();
        if (!isEtapaCustom(key)) throw new Error('Esta etapa já não existe (talvez outro administrador a excluiu).');
      }

      const afetados = data.leads.filter(function (l) { return l.etapa === key; });
      const labelOrigem = etapaLabel(key);
      let labelDestino = '';
      if (afetados.length) {
        if (!destinoKey || destinoKey === key || !etapasGenericas().some(function (e) { return e.key === destinoKey; })) {
          throw new Error('Existem ' + afetados.length + ' lead(s) nesta etapa. Escolha uma etapa de destino válida (sem comportamento especial).');
        }
        labelDestino = etapaLabel(destinoKey);
        const agora = U.nowISO();
        const uid = (window.Auth && Auth.currentId) ? Auth.currentId() : null;
        const texto = 'Movido de ' + labelOrigem + ' para ' + labelDestino + ' (etapa excluída)';

        if (_mode === 'cloud') {
          if (!c) throw new Error('Não foi possível falar com o servidor. Nada foi excluído.');
          const novos = afetados.map(function (l) { return Object.assign({}, l, { etapa: destinoKey, atualizadoEm: agora }); });
          const rowsLeads = novos.map(function (l) { const r = objToRow(l, 'leads'); delete r.owner_uid; return r; });
          const hist = afetados.map(function (l) {
            const h = { id: U.uid(), leadId: l.id, tipo: 'mudanca_etapa', texto: texto, usuarioId: uid || null, data: agora };
            if (l.owner_uid) h.owner_uid = l.owner_uid;
            return h;
          });
          serverError(await c.from('leads').upsert(rowsLeads));
          serverError(await c.from('historico').upsert(hist.map(function (h) { return objToRow(h, 'historico'); })));
          novos.forEach(function (nl) {
            const i = data.leads.findIndex(function (x) { return x.id === nl.id; });
            if (i >= 0) data.leads[i] = nl;
          });
          hist.forEach(function (h) { data.historico.push(h); });
        } else {
          batch(function () {
            afetados.forEach(function (l) {
              update('leads', l.id, { etapa: destinoKey, atualizadoEm: agora });
              logHist(l.id, 'mudanca_etapa', texto, uid);
            });
          });
        }
      }

      setConfig({
        etapasCustom: (data.config.etapasCustom || []).filter(function (e) { return e.key !== key; }),
        etapasOrdem: (data.config.etapasOrdem || []).filter(function (k) { return k !== key; })
      });
      return { movidos: afetados.length, destino: labelDestino };
    } finally {
      _excluindoEtapa = false;
    }
  }
  function qualificacoes() { return QUALIFICACOES.slice(); }
  function qualificacaoInfo(key) { return QUALIFICACOES.find(function (x) { return x.key === key; }) || null; }
  function qualificacaoLabel(key) { const q = qualificacaoInfo(key); return q ? q.label : ''; }
  function constants() {
    return { ETAPAS: ETAPAS, QUALIFICACOES: QUALIFICACOES, MOTIVOS_PERDA: MOTIVOS_PERDA, STATUS_PROPOSTA: STATUS_PROPOSTA, LABEL_PROPOSTA: LABEL_PROPOSTA };
  }

  /* ---------- escrita (retorno síncrono; cache antes do servidor) ---------- */
  function insert(k, obj) {
    assertWritable();
    obj.id = obj.id || U.uid();               // ID gerado localmente — a view usa venda.id na hora
    obj.criadoEm = obj.criadoEm || U.nowISO();
    data[k].push(obj);
    if (COLLECTIONS.indexOf(k) >= 0) pushUpsert(k, objToRow(obj, k));
    flush();
    return obj;
  }
  function update(k, id, patch) {
    assertWritable();
    const i = data[k].findIndex(function (x) { return x.id === id; });
    if (i < 0) return null;
    data[k][i] = Object.assign({}, data[k][i], patch);
    if (COLLECTIONS.indexOf(k) >= 0) {
      const row = objToRow(data[k][i], k);
      /* só grava a coluna owner_uid quando a reatribuição é EXPLÍCITA (owner_uid no patch);
         edição normal não toca no dono — inclusive dos 25 leads antigos (owner_uid NULL). */
      if (!Object.prototype.hasOwnProperty.call(patch, 'owner_uid')) delete row.owner_uid;
      pushUpsert(k, row);
    }
    flush();
    return data[k][i];
  }
  function remove(k, id) {
    assertWritable();
    data[k] = data[k].filter(function (x) { return x.id !== id; });
    if (COLLECTIONS.indexOf(k) >= 0) pushDelete(k, id);
    flush();
  }
  function setConfig(patch) {
    assertWritable();
    data.config = Object.assign({}, data.config, patch);
    if (_mode === 'cloud') {
      const c = sbClient();
      if (c) {
        const snapshot = JSON.parse(JSON.stringify(data.config));
        enqueue(function () { return c.from('config').upsert({ id: 1, data: snapshot }).then(serverError); });
      }
    }
    flush();
  }

  /* ---------- histórico do lead ---------- */
  function logHist(leadId, tipo, texto, usuarioId) {
    assertWritable();
    const h = {
      id: U.uid(), leadId: leadId, tipo: tipo, texto: texto,
      usuarioId: usuarioId || null, data: U.nowISO()
    };
    /* o histórico acompanha o dono do lead (quando o lead já tem owner_uid) */
    const lead = data.leads.find(function (l) { return l.id === leadId; });
    if (lead && lead.owner_uid) h.owner_uid = lead.owner_uid;
    data.historico.push(h);
    pushUpsert('historico', objToRow(h, 'historico'));
    flush();
  }
  function historyOf(leadId) {
    return data.historico.filter(function (h) { return h.leadId === leadId; })
      .sort(function (a, b) { return a.data < b.data ? 1 : -1; });
  }

  /* ---------- dados ---------- */
  function resetAll() {
    if (_mode !== 'local') {
      toast('“Limpar tudo” só está disponível no modo local nesta versão. Nenhum dado foi apagado.');
      return;
    }
    data = blank(); seedInto(data); flush();
  }

  function loadDemo() {
    if (_mode !== 'local' && _mode !== 'cloud') { assertWritable(); return; }
    batch(function () {
      const cons = data.usuarios.filter(function (u) { return u.nivel === 'consultor' && u.status === 'ativo'; });
      if (!cons.length) return;
      const c = function (i) { return cons[i % cons.length].id; };
      const adm = data.config.administradoras;
      const prod = data.produtos;

      const juan = insert('indicadores', { nome: 'Juan Pereira', telefone: '32988887777', obs: 'Cliente antigo, indica bastante.' });
      const ana = insert('indicadores', { nome: 'Ana Ribeiro', telefone: '', obs: '' });

      function lead(nome, tel, origem, etapa, consIdx, extra) {
        return insert('leads', Object.assign({
          nome: nome, telefone: tel, whatsapp: tel, email: '', cidade: 'Juiz de Fora',
          origem: origem, indicadorId: null, consultorId: c(consIdx), obs: '',
          etapa: etapa, proximoContato: null, valorCredito: null, reuniao: null, proposta: null,
          motivoPerda: null, vendaId: null, atualizadoEm: U.nowISO()
        }, extra || {}));
      }
      const l1 = lead('Carlos Souza', '32991112222', 'Indicação', 'fechamento', 0, { indicadorId: juan.id, valorCredito: 300000 });
      lead('Marina Alves', '32993334444', 'Instagram', 'novo', 1);
      lead('Roberto Dias', '32995556666', 'WhatsApp', 'primeira_ligacao', 2);
      lead('Patrícia Gomes', '32997778888', 'Tráfego pago', 'reuniao_agendada', 0, { reuniao: { data: U.todayISO(), hora: '14:00', consultorId: c(0), obs: 'Videochamada' } });
      const l5 = lead('Fernando Lima', '32999990000', 'Indicação', 'proposta_realizada', 1, {
        indicadorId: ana.id, valorCredito: 180000,
        proposta: { valorCredito: 180000, valorParcela: 1250, administradora: adm[0], data: U.todayISO(), consultorId: c(1) }
      });
      lead('Juliana Castro', '32988881111', 'Google', 'nao_fez', 2, { motivoPerda: { motivo: 'Valor da parcela', data: U.todayISO(), consultorId: c(2), obs: '' } });

      insert('simulacoes', { leadId: l5.id, consultorId: c(1), valorCredito: 180000, parcelas: 180, valorParcela: 1250, administradora: adm[0], grupo: '1234', cota: '045', lance: 0, percentualLance: 0, prazo: 180, obs: '' });
      insert('propostas', { leadId: l5.id, clienteNome: 'Fernando Lima', consultorId: c(1), valorCredito: 180000, valorParcela: 1250, administradora: adm[0], data: U.todayISO(), status: 'enviada', obs: '' });

      const v1 = insert('vendas', {
        leadId: l1.id, cliente: 'Carlos Souza', telefone: '32991112222', whatsapp: '32991112222',
        consultorId: c(0), administradora: adm[0], valorCredito: 300000, valorParcela: 1850, numeroCota: '087',
        dataVenda: U.todayISO(), origem: 'Indicação', indicadorId: juan.id, comissao: 4500,
        obs: '', produtoId: prod[0] ? prod[0].id : null, metaId: null, status: 'venda_realizada'
      });
      update('leads', l1.id, { vendaId: v1.id });
      logHist(l1.id, 'venda', 'Venda registrada: ' + U.brl(300000), c(0));
    });
  }

  /* ---------- inicialização: hidrata e re-hidrata a cada mudança de sessão ---------- */
  setTimeout(function () {
    try {
      if (window.Auth && typeof window.Auth.onChange === 'function') {
        window.Auth.onChange(function () {
          if (!sbUser()) clear();     // logout: não mantém dados do usuário anterior na tela
          hydrate();
        });
      }
    } catch (e) { console.error(e); }
    hydrate();
  }, 0);

  return {
    all: all, get: get, config: config, etapas: etapas, etapaLabel: etapaLabel, addEtapaCustom: addEtapaCustom, reordenarEtapas: reordenarEtapas,
    renomearEtapaCustom: renomearEtapaCustom, excluirEtapaCustom: excluirEtapaCustom,
    isEtapaCustom: isEtapaCustom, etapasGenericas: etapasGenericas,
    qualificacoes: qualificacoes, qualificacaoLabel: qualificacaoLabel, qualificacaoInfo: qualificacaoInfo, constants: constants,
    insert: insert, update: update, remove: remove, setConfig: setConfig,
    logHist: logHist, historyOf: historyOf, subscribe: subscribe, batch: batch,
    resetAll: resetAll, loadDemo: loadDemo, _data: function () { return data; },
    /* migração Supabase */
    ready: ready, hydrate: hydrate, clear: clear, ownerUidFor: ownerUidFor,
    /* aguarda a fila de gravação no Supabase esvaziar (não muda nada do fluxo atual) */
    sync: function () { return _queue.catch(function () {}); },
    _mode: function () { return _mode; },
    _error: function () { return _lastError; }
  };
})();
