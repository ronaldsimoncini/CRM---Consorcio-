# CRM Consórcio — LFT

CRM completo para gestão de **leads, atendimento, funil, propostas, vendas, indicações, metas e relatórios**.

## Como abrir

Abra **`index.html`** no navegador (duplo clique). Não precisa instalar nada.
Os dados ficam salvos no próprio navegador (localStorage).

> Já usou a versão anterior? Dê **Ctrl + F5** para recarregar os arquivos novos. Seus dados antigos
> (produtos, consultores, meta e vendas) são migrados automaticamente.

Para publicar online: suba a pasta inteira em Netlify, Vercel, GitHub Pages ou hospedagem comum.

## Primeiro acesso

Tela de login →

- **E-mail:** `relacionamento@lftgestaoderisco.com.br`
- **Senha:** `admin123`

Depois entre em **Configurações → Usuários** e: troque a senha do administrador e cadastre os consultores.

## Logo

Salve o arquivo da logo como **`logo.png`** na raiz do projeto (ao lado do `index.html`).
Aparece no login e no menu lateral. As cores já estão no azul-marinho da LFT
(topo de `css/styles.css`, bloco `:root`).

## Níveis de acesso

| Nível | O que faz |
|---|---|
| **Administrador** | Tudo: usuários, permissões, metas, configurações, todos os dados |
| **Gestor** | Visualiza tudo (equipe, leads, propostas, vendas, relatórios, metas) — sem editar |
| **Consultor** | Cadastra e opera **os próprios leads**: simulações, contatos, propostas, vendas |

## Menu

Dashboard · Leads · Funil · Simulações · Propostas · Vendas · Metas · Consultores · Relatórios · Configurações

- **Dashboard** — visão operacional: total de leads, em atendimento, propostas, vendas, valor vendido,
  vendas recentes, leads recentes, funil resumido, gráfico de vendas (dia/semana/mês), origem dos leads,
  desempenho dos consultores, filtros por período/consultor/administradora/origem, e botão **Relatório de Vendas**.
  **A meta não aparece na Dashboard** (fica só na aba Metas).
- **Funil** — colunas NOVO → PRIMEIRA LIGAÇÃO → REUNIÃO AGENDADA → PROPOSTA REALIZADA → FECHAMENTO → NÃO FEZ O CONSÓRCIO.
  Arraste os cartões (computador) ou toque no botão **⇄** do cartão (iPad/celular). Cada mudança fica no histórico.
- **Painel de Metas para TV** — `painel-tv.html?tv=TOKEN`, tela cheia para televisão, atualiza sozinho.
  Gerencie os links em Configurações → Painel TV. Publicação na internet: veja **DEPLOY.md**.
- **Leads** — lista com filtros (origem, indicado por, consultor, etapa, período, cidade, status).
- **Ficha do lead** — abas Dados / Histórico / Simulações / Propostas + ações rápidas
  (Ligar, WhatsApp, Registrar contato, Agendar reunião, Criar proposta, Mover etapa, Fechar venda, Não realizado).
- **Metas** — a meta é um **valor total a alcançar**. Cada venda ligada à meta abate do valor **restante**
  automaticamente (META / VENDIDO / RESTANTE). Barra visual, projeção, meta individual e de equipe.
- **Consultores** — desempenho individual (leads, propostas, vendas, valor) para controle. Sem ranking/comparação.
- **Relatórios** — Relatório de Vendas e Relatório de Indicações, com **Exportar PDF** (imprimir/salvar) e **Exportar Excel** (CSV).

## Indicações

Ao escolher origem **"Indicação"** no lead, aparece **"Quem indicou?"**. Cadastre a pessoa na hora.
A relação **quem indicou → lead → venda** é mantida: quando o lead vira venda, o valor entra também
nos resultados de quem indicou (aba Relatórios → Indicações).

## Decisões assumidas (avise se quiser mudar)

1. **Data da venda** informada no fechamento (padrão = hoje), permite lançamentos retroativos.
2. Contagem de dias da meta em **dias corridos**.
3. **Cada venda conta em uma única meta** — o sistema escolhe automaticamente a meta ativa mais específica
   (individual > por produto > geral). Ao criar uma meta, as vendas já registradas que se encaixam são
   vinculadas na hora. Uma venda só não entra numa meta cuja data final já passou.
4. Produtos, origens e administradoras são **editáveis pelo admin** em Configurações.
5. Exportação: **PDF** = janela de impressão (salvar como PDF); **Excel** = arquivo `.csv` (abre no Excel).
6. As **etapas do funil são fixas** nesta versão (renomear/personalizar pode ser adicionado depois).

## Dados

- **Configurações → Dados → "Carregar dados de exemplo"**: cria leads/propostas/venda de teste.
- **Configurações → Dados → "Limpar tudo"**: apaga tudo e recria só o administrador.

## Estrutura de arquivos

```
index.html
css/styles.css              cores da marca + layout
js/util.js                  formatação, datas, exportação
js/store.js                 dados (localStorage) + migração
js/auth.js                  login, sessão, permissões
js/components.js            modal, campos, gráficos, cálculo das metas
js/views-dashboard.js
js/views-leads.js           leads + funil + ficha + ações
js/views-comercial.js       simulações, propostas, vendas
js/views-metas.js
js/views-equipe.js          desempenho dos consultores
js/views-relatorios.js
js/views-config.js          configurações + usuários
js/app.js                   shell (menu, topo, rotas)
```
