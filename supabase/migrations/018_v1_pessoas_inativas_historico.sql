-- =====================================================================
-- v1.0.0 - Pessoas inativas (sem exclusão), histórico geral, das pessoas e dos usuários
-- Rode depois da 017: SQL Editor > New query > colar > Run.
--
-- * Pessoa não é mais excluída: só inativada. Inativa não entra em reserva nova, mas as
--   reservas antigas continuam com ela e todo o histórico fica. Quem estava na lixeira
--   volta como inativa. "Pessoas > Excluir" vira "Pessoas > Inativar e reativar".
-- * historico(): consulta o log com filtros (período, quem, tipo, busca), já com o nome
--   do registro (reserva, pessoa, usuário, grupo...). Serve o histórico geral (engrenagem),
--   o da pessoa e o do usuário/grupo, cada um com a sua função na árvore.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Pessoas: ativo / inativo
-- ---------------------------------------------------------------------
alter table public.pessoas add column ativo boolean not null default true;

-- Quem estava na lixeira volta como inativa (o log registra a mudança como "Sistema").
do $$
begin
  perform set_config('app.operacao_interna', 'on', true);
  update public.pessoas set ativo = false, excluido = false where excluido;
  perform set_config('app.operacao_interna', 'off', true);
end $$;

-- Árvore: "Excluir" sai, entra "Inativar e reativar" para os mesmos grupos.
insert into public.funcoes (codigo, pai, tipo, rotulo, descricao, ordem)
values ('pessoas.inativar', 'pessoas', 'funcao', 'Inativar e reativar',
        'Pessoa inativa não aparece para reserva nova; as reservas e o histórico dela continuam.', 64);
insert into public.grupo_funcoes (perfil_id, funcao)
select perfil_id, 'pessoas.inativar' from public.grupo_funcoes where funcao = 'pessoas.excluir'
on conflict do nothing;
delete from public.funcoes where codigo = 'pessoas.excluir';

-- Regras: pessoa nunca vai para a lixeira; ativar/inativar exige a função própria;
-- quem só inativa não altera os outros dados.
create or replace function public.tg_pessoas_ativo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.excluido and not old.excluido then
    raise exception 'Pessoas não são excluídas: use Inativar. O histórico e as reservas dela continuam.';
  end if;
  if auth.uid() is not null and not public.em_operacao_interna() then
    if new.ativo is distinct from old.ativo and not public.tem_funcao('pessoas.inativar') then
      raise exception 'Seu grupo não pode inativar nem reativar pessoas.' using errcode = '42501';
    end if;
    if not public.tem_funcao('pessoas.alterar') and not public.tem_funcao('configuracoes.lixeira')
       and (to_jsonb(new) - 'ativo' - 'alterado_por' - 'alterado_em') is distinct from (to_jsonb(old) - 'ativo' - 'alterado_por' - 'alterado_em') then
      raise exception 'Seu grupo não pode alterar pessoas.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Pedido de exclusão de pessoa explica o caminho certo (antes de conferir permissão).
create or replace function public.excluir_registro(p_tabela text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_modulo text := public.modulo_da_tabela(p_tabela);
  v_qtd integer;
begin
  if p_tabela = 'pessoas' then
    raise exception 'Pessoas não são excluídas: use Inativar. O histórico e as reservas dela continuam.';
  end if;
  if v_modulo is null then raise exception 'Tipo de registro inválido: %', p_tabela; end if;
  if not public.tem_permissao(v_modulo, 'excluir') then
    raise exception 'Seu perfil não pode excluir este registro.' using errcode = '42501';
  end if;
  execute format('update public.%I set excluido = true where id = $1 and not excluido', p_tabela) using p_id;
  get diagnostics v_qtd = row_count;
  if v_qtd = 0 then raise exception 'Registro não encontrado ou já excluído.'; end if;
end $$;

-- "bloquear_..." roda antes da exclusao_logica (ordem alfabética), para a mensagem certa.
create trigger bloquear_exclusao before update on public.pessoas
  for each row execute function public.tg_pessoas_ativo();

drop policy if exists "pessoas: alterar" on public.pessoas;
create policy "pessoas: alterar" on public.pessoas for update using (
  public.tem_funcao('pessoas.alterar') or public.tem_funcao('pessoas.inativar') or public.tem_funcao('configuracoes.lixeira')
);

-- Reserva: locatário/locador novo precisa estar ativo (manter a mesma pessoa continua valendo).
create or replace function public.tg_locacoes_pessoas()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tipo text;
  v_ativo boolean;
begin
  if tg_op = 'INSERT' or new.locatario_id is distinct from old.locatario_id then
    select tipo::text, ativo into v_tipo, v_ativo from public.pessoas where id = new.locatario_id and not excluido;
    if v_tipo is null or v_tipo not in ('locatario', 'ambos') then
      raise exception 'O locatário precisa ser uma pessoa cadastrada como locatário.';
    end if;
    if not v_ativo then
      raise exception 'Este locatário está inativo. Reative a pessoa em Pessoas para usá-la numa reserva.';
    end if;
  end if;
  if tg_op = 'INSERT' or new.locador_id is distinct from old.locador_id then
    select tipo::text, ativo into v_tipo, v_ativo from public.pessoas where id = new.locador_id and not excluido;
    if v_tipo is null or v_tipo not in ('locador', 'ambos') then
      raise exception 'O locador precisa ser uma pessoa cadastrada como locador.';
    end if;
    if not v_ativo then
      raise exception 'Este locador está inativo. Reative a pessoa em Pessoas para usá-la numa reserva.';
    end if;
  end if;
  if tg_op = 'INSERT' or new.responsavel_id is distinct from old.responsavel_id then
    if not exists (
      select 1 from public.usuarios u
      join public.grupo_funcoes g on g.perfil_id = u.perfil_id and g.funcao = 'reservas.visualizar'
      where u.id = new.responsavel_id and u.status_acesso = 'ativo'
    ) then
      raise exception 'O responsável precisa ser um usuário ativo que vê a agenda.';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Histórico: das pessoas (função nova) e consulta com filtros
-- ---------------------------------------------------------------------
insert into public.funcoes (codigo, pai, tipo, rotulo, descricao, ordem)
values ('logs.pessoa', 'logs', 'funcao', 'Histórico das pessoas', 'Relógio no cadastro da pessoa.', 84);
insert into public.grupo_funcoes (perfil_id, funcao)
select perfil_id, 'logs.pessoa' from public.grupo_funcoes where funcao = 'logs.reserva'
on conflict do nothing;

drop policy if exists "log: ler" on public.log_eventos;
create policy "log: ler" on public.log_eventos for select using (
  public.tem_funcao('logs.geral')
  or (locacao_id is not null and public.tem_funcao('logs.reserva'))
  or (tabela in ('usuarios', 'grupo_funcoes', 'perfis') and public.tem_funcao('logs.usuario'))
  or (tabela = 'pessoas' and public.tem_funcao('logs.pessoa'))
);

-- Eventos do log, mais novos primeiro, com o nome do registro pronto.
-- Geral: logs.geral. Um usuário/grupo: logs.usuario. Uma pessoa: logs.pessoa.
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
-- 3. Novidades
-- ---------------------------------------------------------------------
insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v1.0.0', '2026-11-15', array[
    'Lista / Relatório: reservas e parcelas com filtros, totais, colunas à escolha e exportação em CSV',
    'Histórico geral na engrenagem, com filtros por período, pessoa, tipo e busca',
    'Relógio de histórico no usuário, no grupo e na pessoa',
    'Pessoas não são mais excluídas: inativar e reativar (o histórico e as reservas continuam)',
    'Lixeira com busca',
    'Pontinho na versão quando há novidade que você ainda não viu'
  ])
on conflict (numero) do nothing;
