-- =====================================================================
-- v1.1.0 - Movimento e Paróquia no cadastro da pessoa
-- Rode depois da 018: SQL Editor > New query > colar > Run.
--
-- * Dois cadastros novos em Configurações: Movimentos e Paróquias (incluir, renomear,
--   ativar/desativar, ordenar; nunca apagar). Cada um com a sua função na árvore.
-- * Pessoa passa a ter movimento e paróquia, obrigatórios em cadastro novo. As pessoas
--   que já existem ficam em branco até alguém editar (aí a tela pede os dois), e depois
--   de preenchidos não voltam a ficar em branco. Só entra movimento/paróquia ativo;
--   quem já tinha um que foi desativado continua com ele.
-- * Os dois são independentes (a paróquia não depende do movimento).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cadastros: movimentos e paróquias
-- ---------------------------------------------------------------------
create table public.movimentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) between 1 and 80),
  ativo boolean not null default true,
  ordem integer not null default 0
);
create unique index movimentos_nome_unico on public.movimentos (lower(trim(nome)));

create table public.paroquias (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) between 1 and 80),
  ativo boolean not null default true,
  ordem integer not null default 0
);
create unique index paroquias_nome_unico on public.paroquias (lower(trim(nome)));

-- Nome sem espaços sobrando (serve para os dois cadastros).
create or replace function public.tg_cadastro_nome()
returns trigger language plpgsql as $$
begin
  new.nome := trim(new.nome);
  return new;
end $$;

create trigger limpar before insert or update on public.movimentos
  for each row execute function public.tg_cadastro_nome();
create trigger log after insert or update or delete on public.movimentos
  for each row execute function public.tg_log();
create trigger limpar before insert or update on public.paroquias
  for each row execute function public.tg_cadastro_nome();
create trigger log after insert or update or delete on public.paroquias
  for each row execute function public.tg_log();

-- Árvore: Configurações > Movimentos / Paróquias (para quem já cuidava das categorias de anexo).
update public.funcoes set ordem = 98 where codigo = 'configuracoes.lixeira';
insert into public.funcoes (codigo, pai, tipo, rotulo, descricao, ordem) values
  ('configuracoes.movimentos', 'configuracoes', 'funcao', 'Movimentos', 'Cadastro dos movimentos (aparecem no cadastro da pessoa).', 96),
  ('configuracoes.paroquias', 'configuracoes', 'funcao', 'Paróquias', 'Cadastro das paróquias (aparecem no cadastro da pessoa).', 97);
insert into public.grupo_funcoes (perfil_id, funcao)
select perfil_id, f.codigo
from public.grupo_funcoes g
cross join (values ('configuracoes.movimentos'), ('configuracoes.paroquias')) as f(codigo)
where g.funcao = 'configuracoes.categorias_anexo'
on conflict do nothing;

alter table public.movimentos enable row level security;
create policy "movimentos: ativos leem" on public.movimentos for select using (public.usuario_ativo());
create policy "movimentos: incluir" on public.movimentos for insert with check (public.tem_funcao('configuracoes.movimentos'));
create policy "movimentos: alterar" on public.movimentos for update using (public.tem_funcao('configuracoes.movimentos'));
revoke delete on public.movimentos from anon, authenticated;

alter table public.paroquias enable row level security;
create policy "paroquias: ativos leem" on public.paroquias for select using (public.usuario_ativo());
create policy "paroquias: incluir" on public.paroquias for insert with check (public.tem_funcao('configuracoes.paroquias'));
create policy "paroquias: alterar" on public.paroquias for update using (public.tem_funcao('configuracoes.paroquias'));
revoke delete on public.paroquias from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Pessoa: movimento e paróquia
-- ---------------------------------------------------------------------
alter table public.pessoas
  add column movimento_id uuid references public.movimentos (id),
  add column paroquia_id uuid references public.paroquias (id);

create or replace function public.tg_pessoas_movimento_paroquia()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.movimento_id is distinct from old.movimento_id then
    if new.movimento_id is null then
      raise exception 'Escolha o movimento da pessoa.';
    elsif not exists (select 1 from public.movimentos where id = new.movimento_id and ativo) then
      raise exception 'Este movimento está inativo. Reative em Configurações > Movimentos ou escolha outro.';
    end if;
  end if;
  if tg_op = 'INSERT' or new.paroquia_id is distinct from old.paroquia_id then
    if new.paroquia_id is null then
      raise exception 'Escolha a paróquia da pessoa.';
    elsif not exists (select 1 from public.paroquias where id = new.paroquia_id and ativo) then
      raise exception 'Esta paróquia está inativa. Reative em Configurações > Paróquias ou escolha outra.';
    end if;
  end if;
  return new;
end $$;

create trigger movimento_paroquia before insert or update on public.pessoas
  for each row execute function public.tg_pessoas_movimento_paroquia();

-- ---------------------------------------------------------------------
-- 3. Histórico: nome do movimento e da paróquia no histórico geral
-- ---------------------------------------------------------------------
create or replace function public.historico(
  p_tabelas text[] default null,
  p_registro text default null,
  p_usuario uuid default null,
  p_de timestamptz default null,
  p_ate timestamptz default null,
  p_busca text default null,
  p_antes bigint default null,
  p_limite integer default 300
)
returns table (id bigint, tabela text, registro_id text, locacao_id uuid, usuario_id uuid, acao text, campo text,
               valor_anterior text, valor_novo text, data_hora timestamptz, registro text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_busca text := nullif(trim(p_busca), '');
begin
  if not (
    public.tem_funcao('logs.geral')
    or (p_registro is not null and p_tabelas is not null and p_tabelas <@ array['usuarios', 'perfis', 'grupo_funcoes']
        and public.tem_funcao('logs.usuario'))
    or (p_registro is not null and p_tabelas = array['pessoas'] and public.tem_funcao('logs.pessoa'))
  ) then
    raise exception 'Seu grupo não pode ver este histórico.' using errcode = '42501';
  end if;

  return query
  select x.id, x.tabela, x.registro_id, x.locacao_id, x.usuario_id, x.acao, x.campo, x.valor_anterior, x.valor_novo, x.data_hora, x.registro
  from (
    select e.id, e.tabela, e.registro_id, e.locacao_id, e.usuario_id, e.acao, e.campo, e.valor_anterior, e.valor_novo, e.data_hora,
           coalesce(
             case when e.locacao_id is not null then public.texto_reserva(e.locacao_id) end,
             case e.tabela
               when 'pessoas' then (select ps.nome from public.pessoas ps where ps.id::text = e.registro_id)
               when 'usuarios' then (select us.nome from public.usuarios us where us.id::text = e.registro_id)
               when 'perfis' then (select pf.nome from public.perfis pf where pf.id::text = e.registro_id)
               when 'grupo_funcoes' then (select pf.nome from public.perfis pf where pf.id::text = e.registro_id)
               when 'formas_pagamento' then (select f.nome from public.formas_pagamento f where f.id::text = e.registro_id)
               when 'prazos_pagamento' then (select f.nome from public.prazos_pagamento f where f.id::text = e.registro_id)
               when 'categorias_anexo' then (select f.nome from public.categorias_anexo f where f.id::text = e.registro_id)
               when 'movimentos' then (select f.nome from public.movimentos f where f.id::text = e.registro_id)
               when 'paroquias' then (select f.nome from public.paroquias f where f.id::text = e.registro_id)
               when 'configuracoes' then 'Configurações gerais'
             end
           ) as registro
    from public.log_eventos e
    where (p_tabelas is null or e.tabela = any (p_tabelas))
      and (p_registro is null or e.registro_id = p_registro)
      and (p_usuario is null or e.usuario_id = p_usuario)
      and (p_de is null or e.data_hora >= p_de)
      and (p_ate is null or e.data_hora < p_ate)
      and (p_antes is null or e.id < p_antes)
  ) x
  where v_busca is null
     or x.registro ilike '%' || v_busca || '%'
     or x.valor_novo ilike '%' || v_busca || '%'
     or x.valor_anterior ilike '%' || v_busca || '%'
  order by x.id desc
  limit greatest(1, least(coalesce(p_limite, 300), 1000));
end $$;

grant execute on function public.historico(text[], text, uuid, timestamptz, timestamptz, text, bigint, integer) to authenticated;
revoke execute on function public.historico(text[], text, uuid, timestamptz, timestamptz, text, bigint, integer) from public, anon;

-- ---------------------------------------------------------------------
-- 4. Novidades
-- ---------------------------------------------------------------------
insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v1.1.0', '2026-11-16', array[
    'Pessoa com Movimento e Paróquia (obrigatórios em cadastro novo), com cadastro rápido no próprio formulário',
    'Configurações > Movimentos e Configurações > Paróquias',
    'Agenda com filtros de Movimento e Paróquia (do locatário)',
    'Relatório com colunas e filtros de Movimento e Paróquia'
  ])
on conflict (numero) do nothing;
