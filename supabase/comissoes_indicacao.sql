-- =========================================================================
--  CRM Consórcio — "VENDAS POR INDICAÇÃO"   (modelo RPC / SECURITY DEFINER)
--  Arquivo: supabase/comissoes_indicacao.sql
-- -------------------------------------------------------------------------
--  100% ADITIVO E REVERSÍVEL.
--    - NÃO altera nenhuma tabela existente (sem ALTER; os campos novos são
--      chaves dentro do JSONB de usuarios/leads/vendas).
--    - NÃO cria, altera nem remove policy de nenhuma outra tabela.
--    - NÃO faz DROP de objeto existente. NÃO faz backfill. NÃO altera dados.
--
--  MODELO DE SEGURANÇA
--    * A tabela public.comissoes_indicacao tem RLS e SÓ uma policy: SELECT,
--      liberada apenas para admin OU quem tem a permissão 'vendas_indicacao'.
--    * O papel `authenticated` NÃO recebe INSERT/UPDATE/DELETE na tabela.
--      Funcionário comum não lê, não insere, não atualiza e não exclui.
--    * TODA escrita passa por funções RPC SECURITY DEFINER (donas = `postgres`,
--      que é o dono da tabela) — elas ignoram o RLS por serem do dono e
--      aplicam as validações internamente. NÃO usamos FORCE ROW LEVEL
--      SECURITY, justamente para o dono continuar podendo escrever.
--    * O cálculo (valorCredito × 0.01), o percentual e o owner_uid são
--      SEMPRE derivados no servidor a partir da venda e do cadastro de
--      usuarios. O chamador não envia valor, percentual nem owner_uid.
--
--  Como rodar: Supabase → SQL Editor → New query → colar tudo → Run.
--  Rollback:   bloco comentado "ROLLBACK" no fim do arquivo.
-- =========================================================================

begin;

-- =========================================================================
-- 1 · TABELA  public.comissoes_indicacao
--     Modelo do CRM (1 linha = 1 registro; dados em JSONB).
--     owner_uid = auth_uid do FUNCIONÁRIO QUE FEZ A INDICAÇÃO (não o vendedor).
--     id determinístico: 'comind-' || vendaId.
-- =========================================================================
create table if not exists public.comissoes_indicacao (
  id         text primary key,
  owner_uid  uuid references auth.users(id) on delete set null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.comissoes_indicacao is
  'Comissao de indicacao (1%) do funcionario LFT que indicou o cliente. 1 venda = 1 linha. Escrita SOMENTE via RPC SECURITY DEFINER. Leitura restrita (admin ou perm vendas_indicacao).';

-- data (JSONB) — gravado SOMENTE pelas funções abaixo:
--   vendaId, leadId, cliente, consultorId (vendedor), indicadorUsuarioId,
--   valorCredito, percentual (fixo 0.01), valorComissao, dataVenda,
--   status ('pendente' | 'pago'), pagoEm, criadoEm, atualizadoEm

-- =========================================================================
-- 2 · "UMA VENDA = UMA COMISSÃO"
--     (a) PK determinística 'comind-<vendaId>' (as funções sempre usam esse id);
--     (b) índice ÚNICO em data->>'vendaId' — trava definitiva no servidor.
-- =========================================================================
create unique index if not exists ux_comissoes_indicacao_venda
  on public.comissoes_indicacao ((data->>'vendaId'));

create index if not exists idx_comissoes_indicacao_owner
  on public.comissoes_indicacao (owner_uid);
create index if not exists idx_comissoes_indicacao_datavenda
  on public.comissoes_indicacao ((data->>'dataVenda'));
create index if not exists idx_comissoes_indicacao_status
  on public.comissoes_indicacao ((data->>'status'));

-- =========================================================================
-- 3 · PERMISSÃO GRANULAR  has_perm('vendas_indicacao')
--     Lê usuarios.data->'perms' (array JSONB, ex.: ["vendas_indicacao"]).
--     Não existe função equivalente hoje. SECURITY DEFINER, igual a is_admin().
-- =========================================================================
create or replace function public.has_perm(p_perm text)
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
      and coalesce(data->'perms', '[]'::jsonb) ? p_perm
  );
$$;

revoke all on function public.has_perm(text) from public;
grant execute on function public.has_perm(text) to authenticated;

-- =========================================================================
-- 4 · RLS — SOMENTE nesta tabela nova. Nenhuma outra policy é tocada.
--     Uma única policy: SELECT para admin OU permissão 'vendas_indicacao'.
--     Sem policy de INSERT/UPDATE/DELETE -> ninguém escreve direto.
--     Além disso, revogamos os privilégios de escrita de `authenticated`.
-- =========================================================================
alter table public.comissoes_indicacao enable row level security;

revoke all       on public.comissoes_indicacao from anon;
revoke insert, update, delete on public.comissoes_indicacao from authenticated;
grant  select    on public.comissoes_indicacao to   authenticated;

drop policy if exists ci_select on public.comissoes_indicacao;
create policy ci_select on public.comissoes_indicacao
  for select to authenticated
  using ( public.is_admin() or public.has_perm('vendas_indicacao') );

-- (garantia: remove policies de escrita que uma versão anterior tenha criado)
drop policy if exists ci_insert            on public.comissoes_indicacao;
drop policy if exists ci_update            on public.comissoes_indicacao;
drop policy if exists ci_update_pending    on public.comissoes_indicacao;
drop policy if exists ci_update_authorized on public.comissoes_indicacao;
drop policy if exists ci_delete            on public.comissoes_indicacao;

-- =========================================================================
-- 5 · RPC DE SINCRONIZAÇÃO (cálculo automático)
--     public.sync_comissao_indicacao(p_venda_id text) -> jsonb
--
--     Quem chama: qualquer usuário ATIVO da agência (o vendedor/admin que
--     fecha ou edita a venda). Validação interna: is_agency_user().
--
--     A função NÃO recebe valor, percentual nem owner_uid. Ela:
--       1. lê a venda em public.vendas (pelo id);
--       2. checa: status='venda_realizada', origem='Indicação',
--          indicadorUsuarioId preenchido, valorCredito > 0;
--       3. resolve owner_uid = usuarios.auth_uid do indicadorUsuarioId;
--       4. calcula valorComissao = round(valorCredito * 0.01, 2);
--       5. grava em comissoes_indicacao com id = 'comind-'||vendaId:
--            - não existe            -> cria (status 'pendente');
--            - existe e 'pendente'   -> recalcula;
--            - existe e 'pago'       -> NÃO altera (retorna 'inalterada_paga');
--          se a venda deixou de se qualificar (ou não existe):
--            - existe e 'pendente'   -> remove;
--            - existe e 'pago'       -> mantém (retorna 'mantida_paga').
--
--     Retorno: { ok, acao }  — NUNCA devolve o valor da comissão (o chamador
--     comum não pode ver dados financeiros).
-- =========================================================================
create or replace function public.sync_comissao_indicacao(p_venda_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id          text := 'comind-' || p_venda_id;
  v_venda       jsonb;
  v_owner       uuid;
  v_qualifica   boolean := false;
  v_credito     numeric := 0;
  v_valor       numeric := 0;
  v_exists      boolean := false;
  v_cur_status  text;
  v_acao        text;
begin
  if p_venda_id is null or length(trim(p_venda_id)) = 0 then
    raise exception 'venda_id ausente' using errcode = '22023';
  end if;

  if not public.is_agency_user() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  -- 1) venda de origem (SELECT via SECURITY DEFINER — só extrai o necessário)
  select data into v_venda from public.vendas where id = p_venda_id;

  -- 2) a venda se qualifica para gerar comissão de indicação?
  v_qualifica :=
        v_venda is not null
    and coalesce(v_venda->>'status','')             = 'venda_realizada'
    and coalesce(v_venda->>'origem','')             = 'Indicação'
    and coalesce(v_venda->>'indicadorUsuarioId','') <> ''
    and coalesce(nullif(v_venda->>'valorCredito',''),'0')::numeric > 0;

  -- 3) owner_uid = auth_uid do funcionário indicado
  if v_qualifica then
    select u.auth_uid into v_owner
      from public.usuarios u
     where u.id = (v_venda->>'indicadorUsuarioId');
    if not found then
      v_qualifica := false;              -- indicadorUsuarioId não existe no cadastro
    end if;
  end if;

  -- estado atual da comissão desta venda
  select data->>'status' into v_cur_status
    from public.comissoes_indicacao where id = v_id;
  v_exists := found;

  -- ---------------------------------------------------------------------
  -- CAMINHO A · não se qualifica (ou venda inexistente)
  -- ---------------------------------------------------------------------
  if not v_qualifica then
    if v_exists and coalesce(v_cur_status,'pendente') = 'pago' then
      v_acao := 'mantida_paga';
    elsif v_exists then
      delete from public.comissoes_indicacao where id = v_id;
      v_acao := 'removida';
    else
      v_acao := 'ignorada';
    end if;
    return jsonb_build_object('ok', true, 'acao', v_acao);
  end if;

  -- ---------------------------------------------------------------------
  -- CAMINHO B · se qualifica -> criar / recalcular / (paga = intocada)
  -- ---------------------------------------------------------------------
  v_credito := coalesce(nullif(v_venda->>'valorCredito',''),'0')::numeric;
  v_valor   := round(v_credito * 0.01, 2);

  if not v_exists then
    insert into public.comissoes_indicacao (id, owner_uid, data)
    values (
      v_id, v_owner,
      jsonb_build_object(
        'vendaId',            p_venda_id,
        'leadId',             v_venda->>'leadId',
        'cliente',            v_venda->>'cliente',
        'consultorId',        v_venda->>'consultorId',
        'indicadorUsuarioId', v_venda->>'indicadorUsuarioId',
        'valorCredito',       v_credito,
        'percentual',         0.01,
        'valorComissao',      v_valor,
        'dataVenda',          v_venda->>'dataVenda',
        'status',             'pendente',
        'pagoEm',             null,
        'criadoEm',           now(),
        'atualizadoEm',       now()
      )
    )
    on conflict (id) do nothing;   -- corrida: outra chamada já criou
    v_acao := 'criada';

  elsif coalesce(v_cur_status,'pendente') = 'pago' then
    v_acao := 'inalterada_paga';   -- decisão nº 2: comissão paga é protegida

  else
    update public.comissoes_indicacao
       set owner_uid = v_owner,
           data = data || jsonb_build_object(
             'leadId',             v_venda->>'leadId',
             'cliente',            v_venda->>'cliente',
             'consultorId',        v_venda->>'consultorId',
             'indicadorUsuarioId', v_venda->>'indicadorUsuarioId',
             'valorCredito',       v_credito,
             'percentual',         0.01,
             'valorComissao',      v_valor,
             'dataVenda',          v_venda->>'dataVenda',
             'atualizadoEm',       now()
           ),
           updated_at = now()
     where id = v_id
       and coalesce(data->>'status','pendente') = 'pendente';
    v_acao := 'recalculada';
  end if;

  return jsonb_build_object('ok', true, 'acao', v_acao);
end $$;

revoke all on function public.sync_comissao_indicacao(text) from public;
grant execute on function public.sync_comissao_indicacao(text) to authenticated;

-- =========================================================================
-- 6 · RPCs FINANCEIRAS — SOMENTE admin OU permissão 'vendas_indicacao'
-- =========================================================================

-- 6.1 · marcar como pago
create or replace function public.marcar_comissao_indicacao_paga(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.has_perm('vendas_indicacao')) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  update public.comissoes_indicacao
     set data = data || jsonb_build_object(
           'status',       'pago',
           'pagoEm',       (now() at time zone 'America/Sao_Paulo')::date,
           'atualizadoEm', now()),
         updated_at = now()
   where id = p_id;

  if not found then
    raise exception 'Comissao nao encontrada' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.marcar_comissao_indicacao_paga(text) from public;
grant execute on function public.marcar_comissao_indicacao_paga(text) to authenticated;

-- 6.2 · reabrir pagamento (volta para pendente)
create or replace function public.reabrir_comissao_indicacao(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.has_perm('vendas_indicacao')) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  update public.comissoes_indicacao
     set data = (data - 'pagoEm') || jsonb_build_object(
           'status',       'pendente',
           'atualizadoEm', now()),
         updated_at = now()
   where id = p_id;

  if not found then
    raise exception 'Comissao nao encontrada' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.reabrir_comissao_indicacao(text) from public;
grant execute on function public.reabrir_comissao_indicacao(text) to authenticated;

-- 6.3 · correção consciente do valor (inclusive de comissão JÁ PAGA)
--       Recalcula 1% a partir do valorCredito ATUAL da venda de origem.
--       Não recebe valor livre — só o id da comissão.
create or replace function public.recalcular_comissao_indicacao(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venda_id text;
  v_venda    jsonb;
  v_credito  numeric := 0;
  v_valor    numeric := 0;
begin
  if not (public.is_admin() or public.has_perm('vendas_indicacao')) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  select data->>'vendaId' into v_venda_id
    from public.comissoes_indicacao where id = p_id;
  if not found then
    raise exception 'Comissao nao encontrada' using errcode = 'P0002';
  end if;

  select data into v_venda from public.vendas where id = v_venda_id;
  if not found then
    raise exception 'Venda de origem nao encontrada' using errcode = 'P0002';
  end if;

  v_credito := coalesce(nullif(v_venda->>'valorCredito',''),'0')::numeric;
  v_valor   := round(v_credito * 0.01, 2);

  update public.comissoes_indicacao
     set data = data || jsonb_build_object(
           'valorCredito',  v_credito,
           'percentual',    0.01,
           'valorComissao', v_valor,
           'atualizadoEm',  now()),
         updated_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'valorComissao', v_valor);
end $$;

revoke all on function public.recalcular_comissao_indicacao(text) from public;
grant execute on function public.recalcular_comissao_indicacao(text) to authenticated;

-- 6.4 · remover comissão (limpeza pelo financeiro / venda excluída)
create or replace function public.remover_comissao_indicacao(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.has_perm('vendas_indicacao')) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  delete from public.comissoes_indicacao where id = p_id;
  return jsonb_build_object('ok', found);
end $$;

revoke all on function public.remover_comissao_indicacao(text) from public;
grant execute on function public.remover_comissao_indicacao(text) to authenticated;

commit;

-- =========================================================================
--  VERIFICAÇÃO PÓS-EXECUÇÃO (rode separado; nada aqui altera dados)
-- =========================================================================
-- tabela criada e vazia:
--   select count(*) from public.comissoes_indicacao;                       -- 0
--
-- privilégios de `authenticated` na tabela (só deve haver SELECT):
--   select privilege_type from information_schema.role_table_grants
--    where table_schema='public' and table_name='comissoes_indicacao'
--      and grantee='authenticated';                                        -- SELECT
--
-- policies SOMENTE nesta tabela (as demais seguem intactas):
--   select policyname, cmd from pg_policies
--    where schemaname='public' and tablename='comissoes_indicacao';        -- ci_select / SELECT
--
--   select tablename, count(*) from pg_policies
--    where schemaname='public' group by 1 order by 1;
--   -- 'leads','vendas','usuarios',... continuam com a MESMA contagem (p_all)
--
-- funções novas (todas prosecdef = t):
--   select proname, prosecdef from pg_proc
--    where pronamespace='public'::regnamespace
--      and proname in ('has_perm','sync_comissao_indicacao',
--                      'marcar_comissao_indicacao_paga','reabrir_comissao_indicacao',
--                      'recalcular_comissao_indicacao','remover_comissao_indicacao')
--    order by proname;
--
-- teste de leitura (troque o token):
--   -- consultor comum:  GET /rest/v1/comissoes_indicacao?select=id  -> []
--   -- admin / perm:      -> retorna as linhas
--
-- teste de escrita direta (deve FALHAR para qualquer authenticated):
--   -- POST /rest/v1/comissoes_indicacao {...}   -> 401/403 (sem privilégio + RLS)
--   -- PATCH .../comissoes_indicacao?id=eq.x     -> 401/403
--
-- teste da RPC (consultor comum, venda de indicação dele):
--   -- POST /rest/v1/rpc/sync_comissao_indicacao { "p_venda_id": "<id>" }
--   -- -> { "ok": true, "acao": "criada" }   (mas ele continua sem LER a linha)

-- =========================================================================
--  ROLLBACK (desfaz 100% desta migração; execute só se necessário)
-- =========================================================================
-- begin;
--   drop function if exists public.remover_comissao_indicacao(text);
--   drop function if exists public.recalcular_comissao_indicacao(text);
--   drop function if exists public.reabrir_comissao_indicacao(text);
--   drop function if exists public.marcar_comissao_indicacao_paga(text);
--   drop function if exists public.sync_comissao_indicacao(text);
--   drop table    if exists public.comissoes_indicacao;   -- leva índices e policy junto
--   drop function if exists public.has_perm(text);
-- commit;
