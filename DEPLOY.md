# Painel de Metas para TV + Publicação na Internet

Este guia cobre: hospedagem recomendada, como publicar o CRM na nuvem (Supabase + Vercel),
como testar o painel e como abrir na televisão.

---

## Arquitetura final

```
Vendedores (vários PCs)  →  CRM (site estático, Vercel)
                                  │  lê/grava
                                  ▼
                          Banco de dados (Supabase / Postgres)
                                  │
                    função /api/painel  (só o AGREGADO da meta)
                                  ▼
                 Painel-TV  (/painel-tv.html?tv=TV-AGENCIA-01)
                                  ▼
                            Internet (HTTPS)
                                  ▼
                              📺 Televisão
```

- **Um banco só.** As vendas ficam no Supabase. O painel **não** tem banco próprio e **não** duplica venda.
- O painel só recebe números agregados (meta, vendido, % , falta, linha do tempo). Nunca cliente, contrato ou dado pessoal.
- O link da TV é isolado: não é login, não abre o CRM, não acessa nada além do painel.
- Suporta **várias TVs** (um token por TV), cada uma podendo mostrar a mesma meta ou metas diferentes.

---

## Opções de hospedagem (analisadas para este projeto)

O projeto é **site estático** (HTML/CSS/JS, sem build) **+ 1 função serverless** (`api/painel.js`) **+ 1 banco**.

| Host | Serve o CRM | Função `/api` | Banco | Observação |
|---|---|---|---|---|
| **Vercel + Supabase** ✅ *(recomendado)* | Sim (grátis) | Sim (Node) | Supabase (Postgres, grátis) | Menos configuração, HTTPS e domínio inclusos. |
| Netlify + Supabase | Sim | Sim (Netlify Functions) | Supabase | Equivalente ao Vercel. |
| Cloudflare Pages + Supabase | Sim | Sim (Pages Functions) | Supabase | Muito rápido/barato, config um pouco mais técnica. |
| Render / Railway | Sim | — (servidor Node sempre ligado) | Postgres do próprio | Exagero para este caso. |

**Recomendação: Vercel (site + função) + Supabase (banco + login + realtime).**
Ambos têm plano gratuito suficiente para uma agência. HTTPS automático. Domínio `*.vercel.app` grátis
ou domínio próprio (`meucrm.com.br`) depois.

---

## Fase 2 — passo a passo

> A Fase 1 (o painel) já está pronta e funciona local. A Fase 2 coloca tudo na nuvem.
> O passo **6** (ligar o CRM ao Supabase) é a parte que eu ainda preciso implementar no
> `js/store.js` — me avise quando os passos 1–5 estiverem feitos que eu faço a migração e testamos juntos.

### 1. Criar conta e projeto no Supabase
1. Acesse **supabase.com** → *Start your project* → login com GitHub.
2. *New project*. Escolha uma senha forte para o banco (guarde). Região: **South America (São Paulo)**.
3. Espere ~2 min o projeto subir.

### 2. Criar as tabelas
1. No projeto → menu **SQL Editor** → *New query*.
2. Abra o arquivo **`supabase/schema.sql`** deste projeto, copie **tudo**, cole e clique **Run**.
3. Deve aparecer *Success*. Isso cria as tabelas, a segurança (RLS) e a função do painel.

### 3. Criar o primeiro administrador
1. Supabase → **Authentication** → **Users** → **Add user**.
   - E-mail: `relacionamento@lftgestaoderisco.com.br` (ou o que preferir)
   - Senha: escolha uma
   - Marque **Auto Confirm User**.
2. Copie o **User UID** que aparece na lista.
3. Volte no **SQL Editor** e rode (troque `COLE-AQUI-O-USER-UID`):
   ```sql
   insert into usuarios (id, auth_uid, data) values (
     'admin-1', 'COLE-AQUI-O-USER-UID',
     jsonb_build_object('nome','Administrador','email','relacionamento@lftgestaoderisco.com.br',
       'nivel','admin','status','ativo','cargo','Administrador','criadoEm', now())
   );
   ```
   (esse bloco também está comentado no fim do `schema.sql`).

### 4. Pegar as chaves do Supabase
Supabase → **Project Settings** → **API**:
- **Project URL** → ex.: `https://abcd1234.supabase.co`
- **anon public** key → chave pública (vai no `config.js`)
- **service_role** key → chave secreta (vai só no Vercel, **nunca** no `config.js`)

### 5. Publicar no Vercel
**Opção mais fácil (via GitHub):**
1. Crie um repositório no GitHub e suba esta pasta
   (`git init`, `git add .`, `git commit -m "crm"`, `git remote add origin ...`, `git push`).
   O arquivo `.gitignore` já evita subir `config.js` e `node_modules`.
2. Acesse **vercel.com** → login com GitHub → **Add New → Project** → importe o repositório.
3. Framework Preset: **Other**. Build Command: *(vazio)*. Output: *(vazio)*. Clique **Deploy**.
4. Em **Settings → Environment Variables** adicione:
   | Nome | Valor |
   |---|---|
   | `SUPABASE_URL` | a Project URL do passo 4 |
   | `SUPABASE_SERVICE_ROLE_KEY` | a service_role key do passo 4 |
5. **Deployments → Redeploy** para aplicar as variáveis.

Você recebe uma URL tipo `https://crm-consorcio.vercel.app`.
Depois, em **Settings → Domains**, dá para ligar um domínio próprio.

### 6. Ligar o CRM ao Supabase  *(esta parte é comigo)*
Quando os passos 1–5 estiverem prontos, me mande a **Project URL** e a **anon key**.
Eu faço a migração do `js/store.js` para o modo nuvem (mantendo tudo que já funciona),
crio o `config.js`, adiciono o `@supabase/supabase-js` e o login pelo Supabase Auth,
e a atualização em tempo real entre os computadores (Supabase Realtime).
A partir daí todos os PCs veem os mesmos dados.

### 7. Cadastrar as TVs
No CRM (já publicado) → **Configurações → Painel TV**:
1. Digite o nome (ex.: `Agência`) → **+ Adicionar TV**. É gerado um token, ex.: `TV-AGENCIA-A1B2`.
2. Opcional: vincule a TV a uma meta específica (senão ela mostra a meta ativa da equipe).
3. Rode no SQL Editor do Supabase (para o token valer no painel publicado):
   ```sql
   insert into painel_tokens (token, nome, meta_id)
   values ('TV-AGENCIA-A1B2', 'Agência', null);
   ```
   *(quando eu fizer o passo 6, isso passa a ser automático ao adicionar a TV no CRM).*

### 8. URL final do painel
```
https://SEU-DOMINIO/painel-tv.html?tv=TV-AGENCIA-A1B2
```
(uma URL curta tipo `/painel-tv/TV-AGENCIA-A1B2` pode ser adicionada depois com uma
pequena página de redirecionamento, se você quiser.)

---

## Rodar localmente

O CRM é estático — basta abrir **`index.html`** no navegador.
O painel: abra **`painel-tv.html?tv=QUALQUER-COISA`** (no modo local ele mostra a meta ativa da equipe
que existe no navegador). Ou use o botão **📺 Painel TV** na aba Metas.

Para testar a função `/api/painel` localmente (opcional): instale a Vercel CLI
(`npm i -g vercel`), crie um arquivo `.env` com `SUPABASE_URL=` e `SUPABASE_SERVICE_ROLE_KEY=`,
e rode `vercel dev`.

---

## Como testar

### Testar o painel
1. No CRM, crie uma **meta de equipe** (aba Metas → + Nova meta), ex.: R$ 5.000.000, período de 3 meses.
2. Abra o painel (botão 📺 Painel TV). Deve mostrar META R$ 5.000.000, VENDIDO R$ 0, FALTA R$ 5.000.000, 0%.

### Testar a atualização automática
1. Deixe o painel aberto numa aba.
2. Em **outra aba**, no CRM, registre uma venda (aba Vendas → + Nova venda, ou feche um lead no Funil).
3. Em segundos o painel mostra: banner **"NOVA VENDA + R$ X"**, o VENDIDO sobe, a FALTA cai,
   o % muda e o gráfico avança. Sem apertar F5.
   - *Local:* atualização via evento do navegador + verificação a cada 12 s.
   - *Publicado:* o painel consulta `/api/painel` a cada 12 s.

### Testar o acesso da TV
1. Abra o link `.../painel-tv.html?tv=TV-AGENCIA-01` numa aba anônima (sem estar logado no CRM).
2. Deve abrir **só o painel**. Tente trocar a URL para `.../` ou `.../index.html` — o CRM pede login;
   o link da TV não dá acesso a nada além do painel.

### Abrir na televisão
1. Na smart TV, abra o navegador e digite o link `https://SEU-DOMINIO/painel-tv.html?tv=TV-AGENCIA-01`.
2. Aperte **F** (ou o botão ⛶ no canto) para tela cheia.
3. Se a TV não tiver navegador bom, use um **Chromecast**, **Fire TV Stick** ou um **mini PC**
   ligado na HDMI, abrindo o mesmo link no Chrome em modo quiosque.
4. A TV **não precisa** estar no Wi-Fi da agência — qualquer internet serve.

---

## Uso em iPad / tablets

O CRM e o painel funcionam no Safari do iPad. Pontos de atenção:

- **Funil no toque:** arrastar cartão não funciona no iOS. Use o botão **⇄** no canto do cartão
  (ou abra o cartão → "Mover etapa"). O arrastar continua funcionando no computador.
- **Guarde na Tela de Início:** no Safari, abra o site → botão Compartilhar → *Adicionar à Tela de Início*.
  Ao abrir pelo ícone, roda em tela cheia (sem barra do Safari), tanto o CRM quanto o painel.
- **Dados:** com o modo nuvem (Supabase) ativo, os dados ficam no servidor — o iPad é só uma janela,
  sem risco de perder nada se o Safari limpar o cache. **Não use o CRM em iPad só no modo local.**
- **Painel numa TV via iPad:** um iPad antigo preso na parede, aberto no link do painel pelo ícone da
  Tela de Início, funciona como display. Ou use Apple TV / Chromecast / Fire Stick com a TV.

---

## Segurança (resumo)

- HTTPS automático no Vercel.
- A `service_role key` fica **só** nas variáveis de ambiente do Vercel (servidor). Nunca no navegador.
- O painel usa a função `painel_meta()` que retorna **apenas** números agregados da meta.
- As tabelas do CRM têm **RLS**: só usuário autenticado e ativo da agência lê/grava.
- O token da TV não é credencial de login e não concede acesso a nenhuma outra rota.
- `config.js` (com a anon key, que é pública) está no `.gitignore` por precaução.
