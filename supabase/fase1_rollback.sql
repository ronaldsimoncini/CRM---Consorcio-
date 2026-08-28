-- =========================================================================
--  CRM Consórcio — ROLLBACK da FASE 1
--  Desfaz 100% do fase1_owner_uid.sql. Reversível e não-destrutivo:
--  a coluna owner_uid começa e continua NULA nesta fase, então removê-la
--  não perde nenhum dado de negócio.
--
--  NÃO rode isto se a Fase 3 (RLS novo) já tiver sido aplicada — aí o
--  owner_uid está em uso e a remoção quebraria as políticas.
-- =========================================================================

begin;

-- triggers
drop trigger if exists trg_set_owner_uid on public.leads;
drop trigger if exists trg_set_owner_uid on public.historico;
drop trigger if exists trg_set_owner_uid on public.simulacoes;
drop trigger if exists trg_set_owner_uid on public.propostas;
drop trigger if exists trg_set_owner_uid on public.vendas;
drop trigger if exists trg_set_owner_uid on public.metas;

-- funções
drop function if exists public.set_owner_uid();
drop function if exists public.is_admin();
drop function if exists public.is_gestor();

-- índices + coluna
do $$
declare t text;
begin
  foreach t in array array['leads','historico','simulacoes','propostas','vendas','metas'] loop
    execute format('drop index if exists public.idx_%s_owner', t);
    execute format('alter table public.%I drop column if exists owner_uid', t);
  end loop;
end $$;

commit;
