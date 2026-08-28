-- =========================================================================
--  CRM Consórcio — Google Calendar / FASE 2  (NÃO EXECUTAR NESTA FASE)
-- -------------------------------------------------------------------------
--  Tabela para guardar o refresh_token da conta Google de cada usuário do CRM.
--  O vínculo é pelo auth_uid do Supabase (auth.users).
--
--  SEGURANÇA:
--   - RLS LIGADO e SEM política de SELECT/INSERT/UPDATE/DELETE para os papéis
--     'authenticated' e 'anon'  =>  o refresh_token NUNCA é lido nem escrito
--     pelo navegador (anon key). Apenas o service_role (funções serverless)
--     acessa a tabela — e o service_role ignora RLS.
--   - Para o CRM saber apenas "estou conectado?" (sem ver o token), a Fase 2
--     exporá isso por uma RPC security definer ou uma coluna-espelho — a
--     decidir quando implementar a gravação.
--
--  Rode este arquivo só na Fase 2, junto com a implementação de persistTokens().
-- =========================================================================

create table if not exists public.google_calendar_tokens (
  auth_uid      uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  scope         text,
  google_email  text,
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.google_calendar_tokens enable row level security;

-- Sem nenhuma policy: 'authenticated' e 'anon' não leem nem escrevem.
-- (não criar "create policy ... for all" aqui — é proposital)

-- updated_at automático
create or replace function public.touch_google_calendar_tokens()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_touch_google_calendar_tokens on public.google_calendar_tokens;
create trigger trg_touch_google_calendar_tokens
  before update on public.google_calendar_tokens
  for each row execute function public.touch_google_calendar_tokens();

-- =========================================================================
--  ROLLBACK (se precisar desfazer na Fase 2)
-- -------------------------------------------------------------------------
--  drop trigger if exists trg_touch_google_calendar_tokens on public.google_calendar_tokens;
--  drop function if exists public.touch_google_calendar_tokens();
--  drop table if exists public.google_calendar_tokens;
-- =========================================================================
