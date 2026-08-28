/* Função serverless (Vercel):  GET /api/google-calendar/callback
 * -------------------------------------------------------------------------
 * Redirect URI do Google.
 *  - recebe ?code & ?state (ou ?error);
 *  - valida o `state` (assinatura HMAC + expiração) ANTES de qualquer troca;
 *  - recupera o auth_uid do `state`;
 *  - troca o code pelos tokens em https://oauth2.googleapis.com/token;
 *  - FASE 2: persiste a conexão em public.google_calendar_tokens (SERVICE ROLE);
 *  - redireciona de volta ao CRM com ?gcal=connected ou ?gcal=error.
 *
 * Nunca coloca tokens na URL. Nunca escreve tokens em log.
 *
 * ENV: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, OAUTH_STATE_SECRET,
 *      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
'use strict';

const shared = require('./_shared');

/* Base do CRM = o GOOGLE_REDIRECT_URI sem "/api/google-calendar/callback". */
function crmBase() {
  const uri = process.env.GOOGLE_REDIRECT_URI || '';
  const base = uri.replace(/\/api\/google-calendar\/callback\/?$/, '');
  return base || 'https://crm-consorcio-xi.vercel.app';
}

function backToCrm(res, status) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', crmBase() + '/?gcal=' + status);
  return res.status(302).end();
}

/* Persiste a conexão Google do usuário em public.google_calendar_tokens.
 * Toda a gravação usa a SERVICE ROLE KEY (só no servidor). O refresh_token
 * nunca sai daqui — nem para o navegador, nem para log. */
async function persistTokens(auth_uid, tokens) {
  return shared.upsertGoogleTokens(auth_uid, tokens);
}

module.exports = async function handler(req, res) {
  const q = req.query || {};
  const code = q.code;
  const state = q.state;
  const oauthError = q.error; // ex.: access_denied

  try {
    if (oauthError || !code || !state) {
      if (oauthError) console.error('[gcal callback] Google retornou erro:', String(oauthError));
      return backToCrm(res, 'error');
    }

    const need = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'OAUTH_STATE_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
    for (let i = 0; i < need.length; i++) {
      if (!process.env[need[i]]) { console.error('[gcal callback] env ausente'); return backToCrm(res, 'error'); }
    }

    /* valida o state ANTES de trocar qualquer token */
    const st = shared.verifyState(state, process.env.OAUTH_STATE_SECRET);
    if (!st || !st.auth_uid) {
      console.error('[gcal callback] state inválido ou expirado');
      return backToCrm(res, 'error');
    }

    const ex = await shared.exchangeCode(code);
    if (ex.error || !ex.tokens) {
      console.error('[gcal callback] troca de code falhou:', ex.error || 'sem_tokens');
      return backToCrm(res, 'error');
    }

    const saved = await persistTokens(st.auth_uid, ex.tokens);
    if (!saved || saved.error) {
      console.error('[gcal callback] falha ao persistir a conexão:', (saved && saved.error) || 'sem_retorno');
      return backToCrm(res, 'error');
    }

    return backToCrm(res, 'connected');
  } catch (e) {
    console.error('[gcal callback] erro inesperado');
    return backToCrm(res, 'error');
  }
};
