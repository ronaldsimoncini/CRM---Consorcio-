-- =========================================================================
--  CRM Consórcio — ROLLBACK da FASE 4
--  Volta ao estado atual: uma única policy p_all por tabela.
--  Não apaga dados. owner_uid, triggers e funções da Fase 1 permanecem.
-- =========================================================================

begin;

-- remove as políticas da Fase 4
do $$
declare t text;
begin
  foreach t in array array['leads','historico','simulacoes','propostas','vendas','metas',
                           'produtos','indicadores','config','painel_tokens','usuarios'] loop
    execute format('drop policy if exists iso_select          on public.%I', t);
    execute format('drop policy if exists iso_insert          on public.%I', t);
    execute format('drop policy if exists iso_update          on public.%I', t);
    execute format('drop policy if exists iso_delete          on public.%I', t);
    execute format('drop policy if exists iso_select_via_lead on public.%I', t);
    execute format('drop policy if exists shared_read         on public.%I', t);
    execute format('drop policy if exists shared_write        on public.%I', t);
    execute format('drop policy if exists tokens_admin        on public.%I', t);
    execute format('drop policy if exists usuarios_self       on public.%I', t);
    execute format('drop policy if exists usuarios_admin      on public.%I', t);
  end loop;
end $$;

-- recria a policy p_all original em todas as tabelas
do $$
declare t text;
begin
  foreach t in array array['usuarios','produtos','indicadores','leads','simulacoes',
                           'propostas','metas','vendas','historico','config','painel_tokens'] loop
    execute format('drop policy if exists p_all on public.%I', t);
    execute format('create policy p_all on public.%I for all to authenticated using (is_agency_user()) with check (is_agency_user())', t);
  end loop;
end $$;

drop trigger if exists trg_sync_lead_owner on public.leads;
drop function if exists public.sync_lead_owner();
drop view if exists public.equipe;

commit;
