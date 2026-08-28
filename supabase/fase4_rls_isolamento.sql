-- =========================================================================
--  CRM Consórcio — FASE 4 (NÃO EXECUTAR AINDA)
--  Ativa o isolamento definitivo por usuário: troca a policy única p_all
--  por políticas por operação baseadas em owner_uid = auth.uid().
--
--  PRÉ-REQUISITOS (já feitos):
--    - Fase 1: coluna owner_uid + triggers trg_set_owner_uid + is_admin()/is_gestor()
--    - Fase 2: frontend envia owner_uid ao criar/reatribuir
--    - Fase 3: frontend filtra por owner_uid (Auth.owns / Auth.scope)
--
--  ANTES DE RODAR:
--    1. backup completo do banco;
--    2. TODO consultor que deve ter acesso precisa ter usuarios.auth_uid preenchido;
--    3. rodar em janela de manutenção e testar com 2 usuários (ver §TESTE no fim);
--    4. decidir a linha do GESTOR (ver comentário na política de SELECT).
--
--  OS 25 LEADS ANTIGOS: continuam com owner_uid = NULL. Pela política abaixo,
--  só o admin (is_admin()) os enxerga. A vinculação ao funcionário é a Fase 5.
--
--  Rollback: supabase/fase4_rollback.sql  (recria p_all, volta ao estado atual)
-- =========================================================================

begin;

-- -------------------------------------------------------------------------
-- A · view "equipe" — nomes/níveis da equipe para os <select> e lookups,
--     SEM expor e-mail, senha ou auth_uid. Usada pelo frontend quando a
--     tabela usuarios ficar restrita (abaixo).
-- -------------------------------------------------------------------------
create or replace view public.equipe
with (security_invoker = false) as
  select id,
         data->>'nome'   as nome,
         data->>'nivel'  as nivel,
         coalesce(data->>'status','ativo') as status
    from public.usuarios;

grant select on public.equipe to authenticated;

-- -------------------------------------------------------------------------
-- B · trigger de reatribuição: quando o admin troca data->>'consultorId'
--     de um lead, o owner_uid acompanha o auth_uid do novo consultor.
--     (defesa no servidor; o frontend já faz o mesmo na Fase 2/3.)
-- -------------------------------------------------------------------------
create or replace function public.sync_lead_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if (new.data->>'consultorId') is distinct from (old.data->>'consultorId') then
    select auth_uid into v_uid
      from public.usuarios
     where id = (new.data->>'consultorId');
    if v_uid is not null then
      new.owner_uid := v_uid;              -- só migra quando o consultor já tem login
    end if;
  end if;
  return new;
end $$;

create or replace trigger trg_sync_lead_owner
  before update on public.leads
  for each row execute function public.sync_lead_owner();

-- -------------------------------------------------------------------------
-- C · tabelas ISOLADAS: leads, historico, simulacoes, propostas, vendas, metas
--     Remove p_all e cria select/insert/update/delete por owner_uid.
-- -------------------------------------------------------------------------
do $$
declare
  t text;
  -- metas tem uma exceção no SELECT (meta de equipe é de todos)
  extra_select text;
begin
  foreach t in array array['leads','historico','simulacoes','propostas','vendas','metas'] loop
    execute format('drop policy if exists p_all on public.%I', t);

    extra_select := case when t = 'metas'
      then $q$ or (data->>'tipo') = 'equipe'$q$
      else '' end;

    -- SELECT: dono, OU admin, OU gestor (gestor = "vê tudo, só leitura" — comportamento atual).
    --   >>> Para isolar o gestor também, remova "or is_gestor()" desta linha. <<<
    execute format($f$
      create policy iso_select on public.%I for select to authenticated
      using ( owner_uid = auth.uid() or is_admin() or is_gestor()%s )
    $f$, t, extra_select);

    -- INSERT: o registro tem que nascer com o próprio dono (ou o admin cria para outro).
    execute format($f$
      create policy iso_insert on public.%I for insert to authenticated
      with check ( owner_uid = auth.uid() or is_admin() )
    $f$, t);

    -- UPDATE: dono ou admin (linha atual e linha nova).
    execute format($f$
      create policy iso_update on public.%I for update to authenticated
      using ( owner_uid = auth.uid() or is_admin() )
      with check ( owner_uid = auth.uid() or is_admin() )
    $f$, t);

    -- DELETE: dono ou admin.
    execute format($f$
      create policy iso_delete on public.%I for delete to authenticated
      using ( owner_uid = auth.uid() or is_admin() )
    $f$, t);
  end loop;
end $$;

-- Registros-filho: também deixa VER quando o lead-pai é visível (ex.: histórico
-- que o admin registrou no lead de um consultor; simulação criada antes do login).
create policy iso_select_via_lead on public.historico for select to authenticated
  using ( exists (select 1 from public.leads l
                  where l.id = (historico.data->>'leadId')
                    and (l.owner_uid = auth.uid() or is_admin() or is_gestor())) );
create policy iso_select_via_lead on public.simulacoes for select to authenticated
  using ( exists (select 1 from public.leads l
                  where l.id = (simulacoes.data->>'leadId')
                    and (l.owner_uid = auth.uid() or is_admin() or is_gestor())) );
create policy iso_select_via_lead on public.propostas for select to authenticated
  using ( exists (select 1 from public.leads l
                  where l.id = (propostas.data->>'leadId')
                    and (l.owner_uid = auth.uid() or is_admin() or is_gestor())) );
create policy iso_select_via_lead on public.vendas for select to authenticated
  using ( exists (select 1 from public.leads l
                  where l.id = (vendas.data->>'leadId')
                    and (l.owner_uid = auth.uid() or is_admin() or is_gestor())) );

-- -------------------------------------------------------------------------
-- D · tabelas COMPARTILHADAS: todos leem, só admin escreve.
-- -------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['produtos','indicadores','config'] loop
    execute format('drop policy if exists p_all on public.%I', t);
    execute format('create policy shared_read  on public.%I for select to authenticated using (is_agency_user())', t);
    execute format('create policy shared_write on public.%I for all    to authenticated using (is_admin()) with check (is_admin())', t);
  end loop;
end $$;

-- painel_tokens: só admin; leitura pública continua sendo via função serverless.
drop policy if exists p_all on public.painel_tokens;
create policy tokens_admin on public.painel_tokens for all to authenticated
  using (is_admin()) with check (is_admin());

-- -------------------------------------------------------------------------
-- E · usuarios: cada um lê a PRÓPRIA linha; admin lê/gerencia todas.
--     (a equipe inteira, para os <select>, sai da view "equipe" acima.)
-- -------------------------------------------------------------------------
drop policy if exists p_all on public.usuarios;
create policy usuarios_self  on public.usuarios for select to authenticated
  using ( auth_uid = auth.uid() or is_admin() );
create policy usuarios_admin on public.usuarios for all to authenticated
  using ( is_admin() ) with check ( is_admin() );

commit;

-- =========================================================================
--  TESTE (rodar com 2 usuários reais, um consultor A e um consultor B)
-- =========================================================================
-- token de A (DevTools -> Application -> crm_sb_auth):
--   curl "$URL/rest/v1/leads?select=id,owner_uid" -H "apikey:$ANON" -H "Authorization: Bearer $TOKEN_A"
--   -> só linhas de A
--   PATCH/DELETE num lead de B com token de A -> 0 linhas / erro de política
-- admin:
--   vê leads de A, de B e os 25 antigos (owner_uid NULL)
-- recarregar a página como A -> continua vendo só A (isolamento no banco)
--
-- FRONTEND que precisa acompanhar a Fase 4:
--   - Store.hydrate(): para não-admin, hidratar "usuarios" a partir da view "equipe"
--     (select id,nome,nivel,status) em vez da tabela usuarios;
--   - js/components.js usuariosConsultores()/nomeUsuario(): idem, ler de "equipe".
