/* ---------------------------------------------------------------------------
 *  MODO NUVEM (Fase 2)
 *  Copie este arquivo para  config.js  e preencha com os dados do seu projeto
 *  Supabase. A simples presença de config.js faz o CRM usar a nuvem em vez do
 *  navegador (localStorage).
 *
 *  A anon key é PÚBLICA por natureza (protegida pelas políticas RLS do banco).
 *  NUNCA coloque aqui a "service_role key".
 * ------------------------------------------------------------------------- */
window.CRM_CONFIG = {
  supabaseUrl: "https://wluamjaykwdkrzogleig.supabase.co",
  supabaseAnonKey: "sb_publishable__NwOIMWkl0ABGM7qPdSmcw_8_vB5kZH",

  // Base da API do painel (normalmente o próprio domínio). Deixe "" para usar o domínio atual.
  painelApiBase: ""
};
