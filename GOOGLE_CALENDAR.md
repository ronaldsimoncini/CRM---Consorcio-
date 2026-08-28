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

## 6. Fase 2 (próxima — não incluída aqui)

- Rodar `supabase/google-1_tokens.sql`.
- Implementar `persistTokens()` de verdade: UPSERT em
  `public.google_calendar_tokens` via REST com a **service role key**.
- Expor "estou conectado?" ao CRM sem devolver o token.
- Usar o `refresh_token` para criar/atualizar eventos ao agendar reuniões.
