# Integração com o Google Calendar — Fase 1 (fluxo OAuth)

Esta fase entrega **somente o fluxo OAuth 2.0**: o usuário do CRM conecta a
própria conta Google. Ainda **não** grava tokens no banco e **não** cria
reuniões — isso é a Fase 2.

O vínculo é sempre pelo **`auth_uid` do Supabase** do usuário logado.

---

## 1. Google Cloud Console — o que configurar

### 1.1 Habilitar a API
Google Cloud Console → **APIs & Services → Library** → procurar **Google Calendar API** → **Enable**.

### 1.2 OAuth consent screen
**APIs & Services → OAuth consent screen**
- **User type:** External
- **App name / e-mail de suporte / e-mail do desenvolvedor:** preencher
- **Scopes:** adicionar somente
  `https://www.googleapis.com/auth/calendar.events`
- **Test users:** enquanto o app não for publicado, adicionar os e-mails que vão
  testar (o seu e o dos consultores). Sem isso o Google recusa o login.
- Publicar depois, quando o fluxo estiver validado.

### 1.3 Criar o OAuth Client ID
**APIs & Services → Credentials → Create credentials → OAuth client ID**
- **Application type:** Web application
- **Name:** `CRM Consórcio – Calendar`
- **Authorized redirect URIs:** adicionar **exatamente**

  ```
  https://crm-consorcio-xi.vercel.app/api/google-calendar/callback
  ```

- Salvar e copiar o **Client ID** e o **Client secret**.

> A URI de redirect precisa bater caractere por caractere com o valor de
> `GOOGLE_REDIRECT_URI`.

---

## 2. Variáveis de ambiente (Vercel → Project → Settings → Environment Variables)

| Variável | Valor | Observação |
|---|---|---|
| `GOOGLE_CLIENT_ID` | do passo 1.3 | pública por natureza |
| `GOOGLE_CLIENT_SECRET` | do passo 1.3 | **SEGREDO — só no servidor** |
| `GOOGLE_REDIRECT_URI` | `https://crm-consorcio-xi.vercel.app/api/google-calendar/callback` | igual ao Google Cloud |
| `OAUTH_STATE_SECRET` | uma string longa aleatória (ex.: `openssl rand -hex 32`) | **SEGREDO** — assina o `state` do OAuth |
| `SUPABASE_URL` | já existe | valida o JWT do usuário |
| `SUPABASE_ANON_KEY` | já existe | `apikey` na validação do JWT |

`GOOGLE_CLIENT_SECRET` e `OAUTH_STATE_SECRET` **nunca** aparecem no frontend,
em `config.js`, em resposta de API ou em log.

---

## 3. Escopo utilizado

```
https://www.googleapis.com/auth/calendar.events
```

Permite **ver e criar eventos** no Google Calendar do usuário. Nesta fase
**não** pedimos `openid` nem `email`.

---

## 4. Como o fluxo OAuth funciona

```
CRM (usuário logado)
  │  clica "Conectar minha conta Google"  (Configurações → Google Calendar)
  │
  ▼  fetch GET /api/google-calendar/auth      Authorization: Bearer <JWT Supabase>
     ├─ valida o JWT em  {SUPABASE_URL}/auth/v1/user
     ├─ obtém o auth_uid
     ├─ state = base64url({auth_uid, iat, exp}) + "." + HMAC-SHA256(state, OAUTH_STATE_SECRET)
     │         (validade ~10 min)
     └─ responde  { "url": "https://accounts.google.com/o/oauth2/v2/auth?..." }
                  scope=calendar.events & response_type=code
                  & access_type=offline & prompt=consent & state=<assinado>
  │
  ▼  window.location = url   → tela de consentimento do Google
  │
  ▼  Google redireciona:
     GET https://crm-consorcio-xi.vercel.app/api/google-calendar/callback?code=...&state=...
     ├─ verifyState(state)  → confere HMAC + expiração → recupera auth_uid
     │                        (feito ANTES de qualquer troca de token)
     ├─ POST https://oauth2.googleapis.com/token
     │       code, client_id, client_secret, redirect_uri, grant_type=authorization_code
     │       → { access_token, refresh_token, expires_in, scope }
     ├─ persistTokens(auth_uid, tokens)   ← FASE 1: STUB, não grava nada
     └─ 302 → https://crm-consorcio-xi.vercel.app/?gcal=connected   (ou ?gcal=error)
  │
  ▼  CRM lê ?gcal e mostra um toast; limpa o parâmetro da URL.
```

### Segurança
- O `state` é assinado (HMAC) e tem validade curta → amarra o fluxo ao usuário
  autenticado do CRM; a callback não pode ser enganada para vincular tokens à
  conta errada, nem sofrer replay.
- `access_token` e `refresh_token` **nunca** vão para o navegador, `localStorage`,
  `sessionStorage`, query string ou log.
- `GET /api/google-calendar/auth` exige um JWT de sessão válido do Supabase.

---

## 5. Arquivos desta fase

| Arquivo | Papel |
|---|---|
| `api/google-calendar/auth.js` | `GET /api/google-calendar/auth` — monta a URL de consentimento |
| `api/google-calendar/callback.js` | `GET /api/google-calendar/callback` — troca o code; `persistTokens` é STUB |
| `api/google-calendar/_shared.js` | helpers (assinatura de state, validação de JWT, URLs do Google) |
| `supabase/google-1_tokens.sql` | tabela `google_calendar_tokens` — **NÃO executar nesta fase** |
| `js/auth.js` | `Auth.googleCalendarConnect()` |
| `js/views-config.js` | aba "Google Calendar" + leitura de `?gcal` |

---

## 6. Fase 2 — persistência + criação automática de evento (IMPLEMENTADA)

Pré-requisito: a tabela `public.google_calendar_tokens` já criada
(`supabase/google-1_tokens.sql`). Nenhum SQL novo nesta fase — os campos de
vínculo do evento ficam dentro de `reunioes.data` (JSONB).

### 6.1 Persistência da conexão
`api/google-calendar/callback.js` → `persistTokens()` chama
`_shared.upsertGoogleTokens(auth_uid, tokens)`:

- **UPSERT** em `google_calendar_tokens` por `auth_uid` (`Prefer: resolution=merge-duplicates`),
  gravando `refresh_token` e `scope`, **sempre com a `SUPABASE_SERVICE_ROLE_KEY`**.
- `connected_at` é preservado em reconexões (default no 1º insert, não reenviado no merge);
  `updated_at` é atualizado pelo trigger da tabela.
- Se o Google **não** devolver `refresh_token` numa reconexão e já existir linha,
  o `refresh_token` atual **é mantido** (só o `scope` é atualizado). Sem linha e
  sem `refresh_token` → a conexão falha (`?gcal=error`).
- O `refresh_token` **nunca** sai do servidor: não vai para resposta, URL, log,
  `localStorage`/`sessionStorage` nem para o navegador.

### 6.2 `GET /api/google-calendar/status`
Exige `Authorization: Bearer <JWT Supabase>`. `auth_uid` vem só do JWT.
Consulta `google_calendar_tokens` (service role) e responde **apenas**:

```json
{ "connected": true, "google_email": "fulano@gmail.com" }   // google_email só se já conhecido
{ "connected": false }
```

Nunca devolve `refresh_token`.

### 6.3 `POST /api/google-calendar/create-event`
Exige `Authorization: Bearer <JWT Supabase>`.

Body aceito (campos de lead são opcionais):
```json
{ "reuniaoId": "...", "titulo": "...", "data": "2026-08-29",
  "horaInicio": "09:00", "horaFim": "10:00", "observacoes": "...",
  "leadNome": "...", "leadTelefone": "..." }
```

O servidor:
1. obtém `auth_uid` **só do JWT** (ignora qualquer `auth_uid`/`owner_uid` do body);
2. valida os campos (data `AAAA-MM-DD`, horas `HH:MM`, `horaFim >= horaInicio`);
3. busca a reunião pelo `id` (com retry curto ~2 s, porque a gravação do
   frontend pode estar em trânsito) e **exige `reunioes.owner_uid === auth_uid`**;
4. se `data.googleCalendarEventId` já existe → `409 ALREADY_CREATED` (não duplica);
5. obtém um `access_token` a partir do `refresh_token` **desse `auth_uid`**
   (`POST oauth2.googleapis.com/token`, `grant_type=refresh_token`);
6. cria o evento em `POST https://www.googleapis.com/calendar/v3/calendars/primary/events`
   — `summary` = título, `description` = observações (+ lead, se enviado),
   `start`/`end` com `timeZone: America/Sao_Paulo`, **sem attendees / sem convites**;
7. grava `googleCalendarEventId` e `googleCalendarStatus: "created"` dentro de
   `reunioes.data` (service role);
8. se a resposta do evento trouxer `organizer.email`/`creator.email` e o
   `google_email` ainda estiver vazio, preenche (sem escopo extra).

Respostas:
| HTTP | code | significado |
|---|---|---|
| 200 | — | `{ ok:true, eventId }` |
| 400 | `INVALID_INPUT` | dados da reunião inválidos |
| 401 | `UNAUTHENTICATED` | JWT ausente/expirado |
| 404 | `REUNIAO_NOT_FOUND` | reunião não existe **ou não é do usuário** |
| 404 | `GOOGLE_NOT_CONNECTED` | usuário sem Google Calendar conectado |
| 404 | `GOOGLE_REVOKED` | `refresh_token` revogado (linha apagada; reconectar) |
| 409 | `ALREADY_CREATED` | reunião já tem evento (`eventId` no corpo) |
| 502 | `GOOGLE_API_ERROR` / `GOOGLE_ERROR` / `AUTH_CHECK_FAILED` | erro ao falar com Google/Supabase |
| 500 | `INTERNAL` | erro interno |

Nenhuma resposta inclui tokens ou segredos.

### 6.4 Frontend
- `js/store.js` ganhou `Store.sync()` — devolve a Promise da fila de gravação
  interna (só isso; não muda `insert`/`update`/`hydrate`).
- `js/views-reunioes.js`: ao **criar** uma reunião nova → `Store.insert` →
  `await Store.sync()` → `POST /api/google-calendar/create-event`. Falha do
  Google **nunca** desfaz nem impede a reunião. Toasts:
  - ok → "Reunião adicionada ao seu Google Calendar."
  - `GOOGLE_NOT_CONNECTED` → "Reunião salva. Seu Google Calendar ainda não está conectado."
  - `GOOGLE_REVOKED` → "Reunião salva. Sua conexão com o Google Calendar precisa ser refeita."
  - outros → "Reunião salva no CRM, mas não foi possível adicionar ao Google Calendar."
  Na **edição**, se a reunião já tem `googleCalendarEventId`, mostra um aviso e
  **não** mexe no evento.
- `js/views-config.js` → aba Google Calendar mostra "conectado / não conectado"
  (via `/status`) e o botão vira "Reconectar" quando já há conexão.

### 6.5 Fora do escopo desta fase
- **Não** atualiza evento quando a reunião é editada.
- **Não** apaga evento quando a reunião é cancelada (só muda o status no CRM).
- **Não** adiciona convidados/attendees.
- **Não** altera o escopo OAuth (segue só `calendar.events`).

### 6.6 Isolamento
Cada `auth_uid` → só o próprio Google Calendar. O servidor nunca aceita
`auth_uid`/`owner_uid` do navegador; usa sempre o do JWT. Admin, gestor e
consultor: cada um só o seu calendário. Não existe conexão Google global.
