-- =========================================================================
--  CRM Consórcio — FASE 1: preparação do isolamento por usuário
-- -------------------------------------------------------------------------
--  100% ADITIVO E REVERSÍVEL. Não troca o RLS, não mexe em dados, não cria
--  usuários, não faz backfill. O RLS atual (policy p_all) continua valendo
--  exatamente como está — nada no comportamento do CRM muda nesta fase.
--
--  O que este script faz:
--    1. adiciona a coluna owner_uid (uuid) em: leads, historico, simulacoes,
--       propostas, vendas, metas  -> começa NULA em todas as linhas;
--    2. cria índices em owner_uid;
--    3. cria a função + trigger BEFORE INSERT que carimba
--       owner_uid := auth.uid() quando o INSERT não informa o dono;
--    4. cria as funções is_admin() e is_gestor() (ainda NÃO usadas por
--       nenhuma policy — ficam prontas para a Fase 3).
--
--  NÃO incluído nesta fase (vai para a Fase 3, junto com o RLS):
--    - troca da policy p_all;
--    - trigger de reatribuição (owner_uid segue o novo consultorId);
--    - view "equipe";
--    - remoção de usuarios.data.senha;
--    - backfill dos 26 leads.
--
--  Como rodar: Supabase -> SQL Editor -> New query -> colar tudo -> Run.
--  Rollback: supabase/fase1_rollback.sql
-- =========================================================================

begin;

-- -------------------------------------------------------------------------
-- 1 + 2 · coluna owner_uid + índice  (idempotente)
-- -------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['leads','historico','simulacoes','propostas','vendas','metas'] loop
    execute format(
      'alter table public.%I add column if not exists owner_uid uuid references auth.users(id) on delete set null',
      t);
    execute format(
      'create index if not exists idx_%s_owner on public.%I (owner_uid)',
      t, t);
  end loop;
end $$;

-- -------------------------------------------------------------------------
-- 3 · preenchimento automático do dono em novos registros
--     Só age quando owner_uid vem NULO (o admin poderá, na Fase 2, mandar
--     um owner_uid explícito ao criar um registro para outro consultor).
-- -------------------------------------------------------------------------
create or replace function public.set_owner_uid()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.owner_uid is null then
    new.owner_uid := auth.uid();   -- NULL se não houver sessão (ex.: service_role) — tudo bem
  end if;
  return new;
end $$;

create or replace trigger trg_set_owner_uid before insert on public.leads
  for each row execute function public.set_owner_uid();
create or replace trigger trg_set_owner_uid before insert on public.historico
  for each row execute function public.set_owner_uid();
create or replace trigger trg_set_owner_uid before insert on public.simulacoes
  for each row execute function public.set_owner_uid();
create or replace trigger trg_set_owner_uid before insert on public.propostas
  for each row execute function public.set_owner_uid();
create or replace trigger trg_set_owner_uid before insert on public.vendas
  for each row execute function public.set_owner_uid();
create or replace trigger trg_set_owner_uid before insert on public.metas
  for each row execute function public.set_owner_uid();

-- -------------------------------------------------------------------------
-- 4 · funções de papel — criadas agora, USADAS só na Fase 3
--     Validam o papel pela tabela usuarios (server-side), nunca pelo frontend.
-- -------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios
    where auth_uid = auth.uid()
      and coalesce(data->>'status','ativo') = 'ativo'
      and data->>'nivel' = 'admin'
  );
$$;

create or replace function public.is_gestor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios
    where auth_uid = auth.uid()
      and coalesce(data->>'status','ativo') = 'ativo'
      and data->>'nivel' = 'gestor'
  );
$$;

grant execute on function public.is_admin()  to authenticated;
grant execute on function public.is_gestor() to authenticated;

commit;

-- =========================================================================
--  VERIFICAÇÃO PÓS-EXECUÇÃO (rode separado; nada aqui altera dados)
-- =========================================================================
-- 5) coluna owner_uid criada e NULA em todas as tabelas:
--    select table_name, is_nullable, data_type
--      from information_schema.columns
--     where table_schema='public' and column_name='owner_uid'
--     order by table_name;
--
--    select 'leads' t, count(*) total, count(owner_uid) com_dono from public.leads
--    union all select 'historico', count(*), count(owner_uid) from public.historico
--    union all select 'simulacoes',count(*), count(owner_uid) from public.simulacoes
--    union all select 'propostas', count(*), count(owner_uid) from public.propostas
--    union all select 'vendas',    count(*), count(owner_uid) from public.vendas
--    union all select 'metas',     count(*), count(owner_uid) from public.metas;
--    -> com_dono deve ser 0 em todas (nada foi vinculado).
--
-- índices:
--    select indexname, tablename from pg_indexes
--     where schemaname='public' and indexname like 'idx_%_owner' order by tablename;
--
-- triggers:
--    select event_object_table, trigger_name, action_timing, event_manipulation
--      from information_schema.triggers
--     where trigger_schema='public' and trigger_name='trg_set_owner_uid'
--     order by event_object_table;
--
-- funções:
--    select proname, prosecdef from pg_proc
--     where pronamespace='public'::regnamespace and proname in ('set_owner_uid','is_admin','is_gestor');
--
-- 2 + 3) os 26 leads intactos (RLS p_all: rode como service_role/no SQL Editor):
--    select count(*) from public.leads;                        -- espera 26
--    select count(*) from public.leads where owner_uid is null; -- espera 26
--
-- RLS inalterado:
--    select tablename, policyname, cmd from pg_policies
--     where schemaname='public' order by tablename, policyname;
--    -> continua só a policy p_all em cada tabela.
