-- =========================================================================
--  CRM Consórcio — MÓDULO DE REUNIÕES (Fase 1)
-- -------------------------------------------------------------------------
--  NÃO EXECUTAR sem autorização. Rode este arquivo antes de publicar o
--  módulo de Reuniões (js/views-reunioes.js).
--
--  Segue EXATAMENTE o padrão das demais tabelas do CRM:
--    id text pk · owner_uid uuid · data jsonb · updated_at
--  + trigger set_owner_uid() (BEFORE INSERT) — o mesmo já criado na Fase 1
--    do isolamento — que grava owner_uid = auth.uid() do usuário logado.
--  + RLS ligado com a MESMA política p_all das outras tabelas (não altera
--    o p_all de nenhuma tabela existente).
--
--  Isolamento por owner_uid (owner_uid = auth.uid() OR is_admin() ...):
--  será aplicado na fase de isolamento, junto com leads/simulacoes/etc.
--  (bloco comentado no fim deste arquivo).
-- =========================================================================

create table if not exists public.reunioes (
  id          text primary key,
  owner_uid   uuid references auth.users(id) on delete set null,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create index if not exists idx_reunioes_owner on public.reunioes (owner_uid);
create index if not exists idx_reunioes_lead  on public.reunioes ((data->>'leadId'));
create index if not exists idx_reunioes_data  on public.reunioes ((data->>'data'));

-- dono automático no INSERT (reutiliza a função da Fase 1 do isolamento)
create or replace trigger trg_set_owner_uid
  before insert on public.reunioes
  for each row execute function public.set_owner_uid();

-- RLS: mesma baseline de todas as tabelas do CRM
alter table public.reunioes enable row level security;
drop policy if exists p_all on public.reunioes;
create policy p_all on public.reunioes
  for all to authenticated
  using (is_agency_user())
  with check (is_agency_user());

-- =========================================================================
--  ROLLBACK (se precisar desfazer)
-- -------------------------------------------------------------------------
--  drop trigger if exists trg_set_owner_uid on public.reunioes;
--  drop table if exists public.reunioes;
-- =========================================================================

-- =========================================================================
--  FUTURO — fase de isolamento (NÃO executar agora; entra junto de leads/etc.)
-- -------------------------------------------------------------------------
--  drop policy if exists p_all on public.reunioes;
--  create policy iso_select on public.reunioes for select to authenticated
--    using ( owner_uid = auth.uid() or is_admin() or is_gestor() );
--  create policy iso_insert on public.reunioes for insert to authenticated
--    with check ( owner_uid = auth.uid() or is_admin() );
--  create policy iso_update on public.reunioes for update to authenticated
--    using ( owner_uid = auth.uid() or is_admin() )
--    with check ( owner_uid = auth.uid() or is_admin() );
--  create policy iso_delete on public.reunioes for delete to authenticated
--    using ( owner_uid = auth.uid() or is_admin() );
-- =========================================================================
