/* Função serverless (Vercel):  GET /api/painel?tv=TOKEN
 * Retorna SOMENTE o agregado da meta para o Painel da TV.
 * Nunca retorna nome de cliente, venda individual ou dado administrativo.
 * Usa a função painel_meta() do Postgres (Supabase) com a service role key. */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DAY = 86400000;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const token = (req.query && (req.query.tv || req.query.token)) || '';
  if (!token) return res.status(400).json({ ok: false, motivo: 'sem_token' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ ok: false, motivo: 'nao_configurado' });

  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/painel_meta', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_KEY,
        Authorization: 'Bearer ' + SERVICE_KEY
      },
      body: JSON.stringify({ p_token: token })
    });
    const raw = await r.json();
    if (!raw || raw.ok === false) {
      return res.status(200).json({ ok: false, motivo: (raw && raw.motivo) || 'erro' });
    }

    let empresa = 'CRM';
    try {
      const cr = await fetch(SUPABASE_URL + '/rest/v1/config?id=eq.1&select=data', {
        headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY }
      });
      const cj = await cr.json();
      if (cj && cj[0] && cj[0].data && cj[0].data.empresa) empresa = cj[0].data.empresa;
    } catch (e) { /* ignora */ }

    return res.status(200).json(finish(raw, empresa));
  } catch (e) {
    return res.status(500).json({ ok: false, motivo: 'erro', erro: String((e && e.message) || e) });
  }
};

/* mesma fórmula usada em js/painel-tv.js e js/components.js */
function finish(raw, empresa) {
  const meta = raw.meta || {};
  const valorMeta = Number(meta.valorMeta) || 0;
  const vendido = Number(raw.vendido) || 0;
  const restante = Math.max(valorMeta - vendido, 0);
  const excedente = Math.max(vendido - valorMeta, 0);
  const percentual = valorMeta ? vendido / valorMeta * 100 : 0;

  const di = new Date(meta.dataInicio + 'T00:00:00');
  const df = new Date(meta.dataFim + 'T00:00:00');
  const hoje = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00');
  const diasTotais = Math.max(Math.round((df - di) / DAY) + 1, 1);
  const diasDecorridos = Math.max(Math.min(Math.round((hoje - di) / DAY) + 1, diasTotais), 0);
  const diasRestantes = Math.max(Math.round((df - hoje) / DAY), 0);
  const esperadoHoje = valorMeta * (diasDecorridos / diasTotais);
  const acima = vendido >= esperadoHoje;
  const ritmoDia = diasDecorridos > 0 ? vendido / diasDecorridos : 0;
  let projecaoData = null;
  if (ritmoDia > 0 && restante > 0) {
    projecaoData = new Date(hoje.getTime() + Math.ceil(restante / ritmoDia) * DAY).toISOString().slice(0, 10);
  }
  let status = 'em_andamento';
  if (valorMeta > 0 && vendido > valorMeta) status = 'superada';
  else if (valorMeta > 0 && vendido >= valorMeta) status = 'atingida';

  const timeline = [{ d: meta.dataInicio, acc: 0 }].concat(Array.isArray(raw.timeline) ? raw.timeline : []);

  return {
    ok: true, empresa: empresa,
    meta: { nome: meta.nome, valorMeta: valorMeta, dataInicio: meta.dataInicio, dataFim: meta.dataFim },
    vendido: vendido, restante: restante, excedente: excedente, percentual: percentual, status: status,
    ritmo: { esperadoHoje: esperadoHoje, acima: acima, diasRestantes: diasRestantes, projecaoData: projecaoData },
    timeline: timeline, totalVendas: Number(raw.totalVendas) || 0, geradoEm: new Date().toISOString()
  };
}
