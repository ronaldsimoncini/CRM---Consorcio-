-- =========================================================================
--  CRM Consórcio — Schema Supabase (Fase 2)
--  Rode este arquivo inteiro no Supabase: SQL Editor → New query → colar → Run
--  Modelo: 1 linha = 1 registro, os dados ficam em JSONB (`data`) exatamente
--  no mesmo formato que o CRM já usa hoje. Nada de duplicar vendas.
-- =========================================================================

create extension if not exists pgcrypto;

-- ---------- tabelas (uma por "coleção" do CRM) ----------
create table if not exists usuarios    ( id text primary key, auth_uid uuid unique, data jsonb not null default '{}'::jsonb, updated_at timestamptz default now() );
create table if not exists produtos    ( id text primary key, data jsonb not null default '{}'::jsonb, updated_at timestamptz default now() );
create table if not exists indicadores ( id text primary key, data jsonb not null default '{}'::jsonb, updated_at timestamptz default now() );
create table if not exists leads       ( id text primary key, data jsonb not null default '{}'::jsonb, updated_at timestamptz default now() );
create table if not exists simulacoes  ( id text primary key, data jsonb not null default '{}'::jsonb, updated_at timestamptz default now() );
create table if not exists propostas   ( id text primary key, data jsonb not null default '{}'::jsonb, updated_at timestamptz default now() );
create table if not exists metas       ( id text primary key, data jsonb not null default '{}'::jsonb, updated_at timestamptz default now() );
create table if not exists vendas      ( id text primary key, data jsonb not null default '{}'::jsonb, updated_at timestamptz default now() );
create table if not exists historico   ( id text primary key, data jsonb not null default '{}'::jsonb, updated_at timestamptz default now() );
create table if not exists config      ( id int  primary key default 1, data jsonb not null default '{}'::jsonb );
insert into config (id) values (1) on conflict do nothing;

create table if not exists painel_tokens (
  token   text primary key,
  nome    text not null,
  meta_id text,
  criado_em timestamptz default now()
);

create index if not exists idx_vendas_meta   on vendas   ((data->>'metaId'));
create index if not exists idx_vendas_status  on vendas   ((data->>'status'));
create index if not exists idx_leads_etapa    on leads    ((data->>'etapa'));
create index if not exists idx_hist_lead      on historico((data->>'leadId'));

-- ---------- quem é usuário ativo da agência ----------
create or replace function is_agency_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from usuarios
    where auth_uid = auth.uid() and coalesce(data->>'status','ativo') = 'ativo'
  );
$$;

-- ---------- RLS: só usuário autenticado e ativo lê/escreve o CRM ----------
do $$
declare t text;
begin
  foreach t in array array['usuarios','produtos','indicadores','leads','simulacoes',
                           'propostas','metas','vendas','historico','config','painel_tokens'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists p_all on %I', t);
    execute format('create policy p_all on %I for all to authenticated using (is_agency_user()) with check (is_agency_user())', t);
  end loop;
end $$;

-- =========================================================================
--  Agregado da META para o Painel da TV (NÃO expõe cliente nem venda a venda)
--  Chamado pela função serverless /api/painel — retorna só números da meta.
-- =========================================================================
create or replace function painel_meta(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_meta_id text;
  m jsonb;
  v_vendido numeric;
  v_count int;
  v_timeline jsonb;
begin
  select meta_id into v_meta_id from painel_tokens where token = p_token;

  if v_meta_id is null then
    select id into v_meta_id from metas
     where (data->>'tipo') = 'equipe'
       and coalesce(data->>'statusManual','') <> 'encerrada'
     order by (data->>'dataFim') asc nulls last
     limit 1;
  end if;

  if v_meta_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_meta');
  end if;

  select data into m from metas where id = v_meta_id;

  select coalesce(sum((data->>'valorCredito')::numeric), 0), count(*)
    into v_vendido, v_count
    from vendas
   where data->>'metaId' = v_meta_id
     and coalesce(data->>'status','') = 'venda_realizada';

  select coalesce(jsonb_agg(jsonb_build_object('d', d, 'acc', acc) order by d), '[]'::jsonb)
    into v_timeline
  from (
    select (data->>'dataVenda') as d,
           sum((data->>'valorCredito')::numeric)
             over (order by (data->>'dataVenda')
                   rows between unbounded preceding and current row) as acc
      from vendas
     where data->>'metaId' = v_meta_id
       and coalesce(data->>'status','') = 'venda_realizada'
  ) s;

  return jsonb_build_object(
    'ok', true,
    'metaId', v_meta_id,
    'meta', jsonb_build_object(
      'nome', m->>'nome',
      'valorMeta', (m->>'valorMeta')::numeric,
      'dataInicio', m->>'dataInicio',
      'dataFim', m->>'dataFim'
    ),
    'vendido', v_vendido,
    'totalVendas', v_count,
    'timeline', v_timeline
  );
end $$;

grant execute on function painel_meta(text) to anon, authenticated;

-- =========================================================================
--  PRIMEIRO ADMINISTRADOR
--  1) Supabase → Authentication → Users → Add user  (e-mail + senha, "Auto Confirm")
--  2) copie o User UID gerado e rode o comando abaixo trocando os valores:
-- =========================================================================
-- insert into usuarios (id, auth_uid, data) values (
--   'admin-1',
--   'COLE-AQUI-O-USER-UID',
--   jsonb_build_object(
--     'nome','Administrador',
--     'email','relacionamento@lftgestaoderisco.com.br',
--     'nivel','admin',
--     'status','ativo',
--     'cargo','Administrador',
--     'criadoEm', now()
--   )
-- ) on conflict (id) do update set auth_uid = excluded.auth_uid, data = excluded.data;

-- Produtos iniciais (opcional):
-- insert into produtos (id, data) values
--  (gen_random_uuid()::text, '{"nome":"Imóvel","ativo":true}'),
--  (gen_random_uuid()::text, '{"nome":"Veículo","ativo":true}'),
--  (gen_random_uuid()::text, '{"nome":"Moto","ativo":true}'),
--  (gen_random_uuid()::text, '{"nome":"Serviços","ativo":true}'),
--  (gen_random_uuid()::text, '{"nome":"Pesados","ativo":true}');
