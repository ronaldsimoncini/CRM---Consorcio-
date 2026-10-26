# Ferramenta de migração — backup do CRM → Supabase

Ferramenta **local** (roda no navegador) para migrar os dados do backup JSON
exportado pelo CRM (modo `localStorage`) para o Supabase.

> **Nada é escrito no Supabase sem confirmação explícita.**
> A ferramenta só faz `INSERT` de registros **novos**. Nunca `update`, `upsert`
> ou `delete`. Nunca toca no Supabase Auth. Nunca sobrescreve `config`.

## Arquivos

| Arquivo | Função |
|---|---|
| `index.html` | Interface da ferramenta. Abrir direto no navegador. |
| `migrate.js` | Toda a lógica (análise, deduplicação, inserção). |
| `README.md` | Este documento. |

Nenhum arquivo do CRM (`js/`, `index.html` raiz, `css/`, `supabase/schema.sql`,
`api/`, `config.js`, `vercel.json`) foi criado ou alterado.

## Como usar (quando for a hora)

1. Abra `tools/migrate-backup/index.html` no navegador.
2. **Passo 1** – confirme a URL/anon key (o botão tenta ler do `config.js`) e faça
   login com um usuário **admin** do CRM. O login é obrigatório porque o RLS só
   libera leitura/escrita para usuário autenticado da agência. A senha não é
   guardada.
3. **Passo 2** – selecione o arquivo `crm-backup-AAAA-MM-DD-HHMM.json`.
4. **Passo 3** – clique **Analisar**. Gera o relatório (totais, novos, já
   existentes, conflitos). **Não escreve nada.**
5. **Passo 4** – só se o relatório estiver ok, clique **Executar migração** e
   digite `MIGRAR`. Depois, **Baixar log / relatório**.

## Análise do backup `crm-backup-2026-08-28-1041.json`

Exportado em `2026-08-28T13:41:42Z`, chave `crm_consorcio_v1`.

| Coleção | Registros | Destino |
|---|---:|---|
| `usuarios` | 1 | tabela `usuarios` — **sem senha, sem auth_uid** |
| `consultores` | 0 | **ignorada** (não existe tabela) |
| `produtos` | 5 | tabela `produtos` |
| `indicadores` | 0 | nada a migrar |
| `leads` | 23 | tabela `leads` |
| `simulacoes` | 0 | **ignorada** (vazia) |
| `propostas` | 0 | **ignorada** (vazia) |
| `vendas` | 0 | **ignorada** (vazia) |
| `metas` | 1 | tabela `metas` |
| `historico` | 42 | tabela `historico` — `leadId` preservado |
| `config` | 1 | **tratada à parte — nunca sobrescreve** |

**Total de registros que a ferramenta tentará inserir (se todos forem novos):**
1 usuário + 5 produtos + 23 leads + 1 meta + 42 históricos = **72**.

### Relacionamentos verificados

- Todos os 42 `historico[].leadId` apontam para um dos 23 leads do backup — sem
  órfãos. Os IDs são preservados 1:1, então o vínculo continua válido no Supabase.
- Todos os `historico[].usuarioId` e `leads[].reuniao.consultorId` apontam para
  `idwnv57sfsgy4v` (o único usuário do backup, o Administrador).
- `metas[0].responsavel` = `"THIAGO"` (texto livre, não é um ID).
- Nenhum lead tem `consultorId`, `indicadorId`, `vendaId` ou `proposta`
  preenchidos.

### Conflito conhecido a decidir manualmente (a ferramenta só avisa)

O Administrador do backup tem `id = idwnv57sfsgy4v` e
`email = relacionamento@lftgestaoderisco.com.br`. Se o Supabase já tiver um
usuário admin com **esse mesmo e-mail mas outro id** (o admin criado no
`schema.sql` / Supabase Auth), a ferramenta marca como **CONFLITO** e **não
migra** esse usuário. Nesse caso:

- **NÃO** haverá duplicação automática.
- Você decide: (a) manter só o admin já existente e, se quiser, atualizar o
  `historico`/`leads` para o id dele; ou (b) inserir o usuário do backup como
  registro histórico (sem login).
- Enquanto isso, o `historico` e as reuniões continuam referenciando
  `idwnv57sfsgy4v`; se esse id não existir em `usuarios`, as telas mostram
  "(removido)" no lugar do nome — sem quebrar nada.

Se o Supabase **não** tiver esse e-mail ainda, o usuário do backup é inserido
como **novo**, porém **sem `senha` e sem `auth_uid`** — ele não consegue logar
até ser vinculado manualmente no Supabase Auth (etapa futura, fora deste passo).

## Como a duplicação é evitada

1. Antes de qualquer escrita, a ferramenta faz `select('id')` em `usuarios`,
   `produtos`, `indicadores`, `leads`, `metas` e `historico` e monta um conjunto
   de IDs já existentes.
2. Cada registro do backup é classificado:
   - **novo** — id não existe no Supabase → entra na fila de `INSERT`.
   - **já existente** — id já existe → **pulado** (o registro do servidor é
     mantido; o conteúdo não é comparado nem alterado).
   - **conflito** — id repetido dentro do próprio backup; usuário com e-mail
     igual e id diferente; histórico com `leadId` inexistente → **pulado** e
     apenas relatado.
3. A inserção usa `insert()` (nunca `upsert`), só com os registros "novos", na
   ordem `usuarios → produtos → indicadores → leads → metas → historico`. Se o
   banco recusar um id por já existir (corrida), a linha é contada como falha e
   registrada no log — nada é sobrescrito.
4. Se qualquer tabela não puder ser lida (RLS, tabela inexistente, rede), a
   migração inteira fica **bloqueada** — sem leitura confiável, não há escrita.

## Logs

- Painel de log na tela, com timestamp por linha.
- Botão **Baixar log / relatório** gera um `.json` com: análise completa,
  resultado da migração (inseridos/falhas por coleção) e o log linha a linha.

## Garantias desta etapa

- Nenhum dado do Supabase foi lido ou alterado ao criar a ferramenta.
- A ferramenta não roda nada sozinha ao abrir; só reage a cliques.
- `config`, `consultores`, `simulacoes`, `propostas`, `vendas` nunca são
  escritos por ela.
