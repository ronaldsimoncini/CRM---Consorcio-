/* Camada de dados - tudo no localStorage do navegador.
   Coleções: usuarios, produtos, leads, indicadores, simulacoes, propostas, vendas, metas, historico */
window.Store = (function () {
  const KEY = 'crm_consorcio_v1';
  const subs = [];

  const DEFAULT_ORIGENS = ['Instagram', 'WhatsApp', 'Facebook', 'Google', 'Site', 'Tráfego pago', 'Indicação', 'Prospecção', 'Evento', 'Outro'];
  const DEFAULT_ADMINS = ['Porto', 'Itaú', 'Âncora', 'HS Consórcios', 'Embracon', 'Rodobens', 'Servopa', 'Bancorbrás'];
  const ETAPAS = [
    { key: 'novo', label: 'NOVO' },
    { key: 'primeira_ligacao', label: 'PRIMEIRA LIGAÇÃO' },
    { key: 'reuniao_agendada', label: 'REUNIÃO AGENDADA' },
    { key: 'proposta_realizada', label: 'PROPOSTA REALIZADA' },
    { key: 'fechamento', label: 'FECHAMENTO' },
    { key: 'nao_fez', label: 'NÃO FEZ O CONSÓRCIO' }
  ];
  const MOTIVOS_PERDA = ['Não teve interesse', 'Valor da parcela', 'Preferiu esperar', 'Não conseguiu aprovação', 'Comprou outra opção', 'Sem retorno', 'Outro'];
  const STATUS_PROPOSTA = ['rascunho', 'enviada', 'em_analise', 'negociacao', 'aprovada', 'recusada', 'cancelada'];
  const LABEL_PROPOSTA = {
    rascunho: 'Rascunho', enviada: 'Enviada', em_analise: 'Em análise', negociacao: 'Negociação',
    aprovada: 'Aprovada', recusada: 'Recusada', cancelada: 'Cancelada'
  };

  let data = load();
  let _batch = 0, _dirty = false;

  function blank() {
    return {
      usuarios: [], consultores: [], produtos: [], leads: [], indicadores: [],
      simulacoes: [], propostas: [], vendas: [], metas: [], historico: [],
      config: { empresa: 'LFT Consórcios', origens: DEFAULT_ORIGENS.slice(), administradoras: DEFAULT_ADMINS.slice(), painelTokens: [] },
      _seeded: false, _v: 2
    };
  }

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

  /* Garante estrutura mínima ao abrir dados de versões anteriores */
  function migrate(d) {
    d.config = d.config || {};
    if (!d.config.empresa) d.config.empresa = 'LFT Consórcios';
    if (!d.config.origens || !d.config.origens.length) d.config.origens = DEFAULT_ORIGENS.slice();
    if (!d.config.administradoras || !d.config.administradoras.length) d.config.administradoras = DEFAULT_ADMINS.slice();
    if (!Array.isArray(d.config.painelTokens)) d.config.painelTokens = [];
    ['usuarios', 'consultores', 'produtos', 'leads', 'indicadores', 'simulacoes', 'propostas', 'vendas', 'metas', 'historico']
      .forEach(function (k) { if (!Array.isArray(d[k])) d[k] = []; });

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

  function seedInto(d) {
    migrate(d);
    d._seeded = true;
    return d;
  }

  function save() {
    if (_batch > 0) { _dirty = true; return; }
    localStorage.setItem(KEY, JSON.stringify(data));
    subs.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
  }
  function batch(fn) {
    _batch++;
    try { fn(); } finally {
      _batch--;
      if (_batch === 0 && _dirty) { _dirty = false; save(); }
    }
  }
  function subscribe(fn) { subs.push(fn); }

  /* ---------- leitura ---------- */
  function all(k) { return data[k].slice(); }
  function get(k, id) { return data[k].find(function (x) { return x.id === id; }); }
  function config() { return data.config; }
  function etapas() { return ETAPAS.slice(); }
  function etapaLabel(key) { const e = ETAPAS.find(function (x) { return x.key === key; }); return e ? e.label : key; }
  function constants() {
    return { ETAPAS: ETAPAS, MOTIVOS_PERDA: MOTIVOS_PERDA, STATUS_PROPOSTA: STATUS_PROPOSTA, LABEL_PROPOSTA: LABEL_PROPOSTA };
  }

  /* ---------- escrita ---------- */
  function insert(k, obj) {
    obj.id = obj.id || U.uid();
    obj.criadoEm = obj.criadoEm || U.nowISO();
    data[k].push(obj);
    save();
    return obj;
  }
  function update(k, id, patch) {
    const i = data[k].findIndex(function (x) { return x.id === id; });
    if (i < 0) return null;
    data[k][i] = Object.assign({}, data[k][i], patch);
    save();
    return data[k][i];
  }
  function remove(k, id) {
    data[k] = data[k].filter(function (x) { return x.id !== id; });
    save();
  }
  function setConfig(patch) { data.config = Object.assign({}, data.config, patch); save(); }

  /* ---------- histórico do lead ---------- */
  function logHist(leadId, tipo, texto, usuarioId) {
    data.historico.push({
      id: U.uid(), leadId: leadId, tipo: tipo, texto: texto,
      usuarioId: usuarioId || null, data: U.nowISO()
    });
    save();
  }
  function historyOf(leadId) {
    return data.historico.filter(function (h) { return h.leadId === leadId; })
      .sort(function (a, b) { return a.data < b.data ? 1 : -1; });
  }

  /* ---------- dados ---------- */
  function resetAll() { data = blank(); seedInto(data); save(); }

  function loadDemo() {
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

  return {
    all: all, get: get, config: config, etapas: etapas, etapaLabel: etapaLabel, constants: constants,
    insert: insert, update: update, remove: remove, setConfig: setConfig,
    logHist: logHist, historyOf: historyOf, subscribe: subscribe, batch: batch,
    resetAll: resetAll, loadDemo: loadDemo, _data: function () { return data; }
  };
})();
