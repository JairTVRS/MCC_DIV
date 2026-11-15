-- =====================================================================
-- v0.4.0 - Cadastro de pessoas e da reserva (etapa 4)
-- Rode depois da 007: SQL Editor > New query > colar > Run.
--
-- * A mesma pessoa pode ser locatário e locador (tipo "ambos").
-- * A reserva só aceita como locatário quem é locatário (ou ambos), como locador quem é
--   locador (ou ambos), e como responsável um usuário ativo que vê a agenda.
-- * conflito_reserva(): diz qual pré-reserva/reserva ocupa um horário, para a tela avisar
--   antes de salvar (o banco continua barrando pela constraint de exclusão).
-- =====================================================================

alter type public.tipo_pessoa add value if not exists 'ambos';

-- ---------------------------------------------------------------------
-- 1. Pessoas: campos limpos
-- ---------------------------------------------------------------------
create or replace function public.tg_pessoas_limpar()
returns trigger language plpgsql as $$
begin
  new.nome := trim(new.nome);
  new.telefone := nullif(trim(new.telefone), '');
  new.email := nullif(lower(trim(new.email)), '');
  new.documento := nullif(trim(new.documento), '');
  return new;
end $$;

create trigger limpar before insert or update on public.pessoas
  for each row execute function public.tg_pessoas_limpar();

-- ---------------------------------------------------------------------
-- 2. Reserva: locatário, locador e responsável válidos
-- ---------------------------------------------------------------------
create or replace function public.tg_locacoes_pessoas()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tipo text;
begin
  if tg_op = 'INSERT' or new.locatario_id is distinct from old.locatario_id then
    select tipo::text into v_tipo from public.pessoas where id = new.locatario_id and not excluido;
    if v_tipo is null or v_tipo not in ('locatario', 'ambos') then
      raise exception 'O locatário precisa ser uma pessoa cadastrada como locatário.';
    end if;
  end if;
  if tg_op = 'INSERT' or new.locador_id is distinct from old.locador_id then
    select tipo::text into v_tipo from public.pessoas where id = new.locador_id and not excluido;
    if v_tipo is null or v_tipo not in ('locador', 'ambos') then
      raise exception 'O locador precisa ser uma pessoa cadastrada como locador.';
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

create trigger pessoas_validas before insert or update on public.locacoes
  for each row execute function public.tg_locacoes_pessoas();

-- ---------------------------------------------------------------------
-- 3. Conflito de horário: qual reserva está no caminho
-- ---------------------------------------------------------------------
create or replace function public.conflito_reserva(p_inicio timestamptz, p_fim timestamptz, p_ignorar uuid default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_texto text;
begin
  if not public.tem_funcao('reservas.visualizar') then
    raise exception 'Seu grupo não vê a agenda.' using errcode = '42501';
  end if;
  select public.texto_reserva(l.id) || ' (' || to_char(l.inicio at time zone 'America/Sao_Paulo', 'HH24:MI')
         || ' às ' || to_char(l.fim at time zone 'America/Sao_Paulo', 'HH24:MI') || ')'
    into v_texto
  from public.locacoes l
  where not l.excluido
    and l.status_compromisso in ('pre_reserva', 'reservado')
    and l.espaco_id = public.espaco_padrao()
    and l.periodo && tstzrange(p_inicio, p_fim, '[)')
    and (p_ignorar is null or l.id <> p_ignorar)
  order by l.inicio
  limit 1;
  return v_texto;
end $$;

grant execute on function public.conflito_reserva(timestamptz, timestamptz, uuid) to authenticated;
revoke execute on function public.conflito_reserva(timestamptz, timestamptz, uuid) from public, anon;

-- ---------------------------------------------------------------------
-- 4. Lixeira: rótulo de quem é locatário e locador
-- ---------------------------------------------------------------------
create or replace function public.listar_lixeira()
returns table (tabela text, id uuid, descricao text, detalhe text, excluido_por_nome text, excluido_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.tem_acao('restaurar_lixeira') then
    raise exception 'Só quem tem acesso à lixeira pode ver os itens excluídos.' using errcode = '42501';
  end if;

  return query
  select x.tabela, x.id, x.descricao, x.detalhe, u.nome, x.excluido_em
  from (
    select 'locacoes'::text as tabela, l.id,
           ('Reserva de ' || pe.nome)::text as descricao,
           (to_char(l.inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
             || ' · ' || case l.status_compromisso
                           when 'cadastrado' then 'Cadastrado'
                           when 'pre_reserva' then 'Pré-reserva'
                           when 'reservado' then 'Reservado'
                           else 'Cancelado'
                         end
             || coalesce(' · leva junto ' || nullif(concat_ws(', ',
                  case when k.np > 0 then k.np || case when k.np = 1 then ' parcela' else ' parcelas' end end,
                  case when k.na > 0 then k.na || case when k.na = 1 then ' anexo' else ' anexos' end end,
                  case when k.nc > 0 then k.nc || case when k.nc = 1 then ' comentário' else ' comentários' end end), ''), '')
           )::text as detalhe,
           l.excluido_por, l.excluido_em
    from public.locacoes l
    join public.pessoas pe on pe.id = l.locatario_id
    cross join lateral (
      select (select count(*) from public.parcelas c where c.locacao_id = l.id and c.excluido and c.excluido_em = l.excluido_em) as np,
             (select count(*) from public.anexos c where c.locacao_id = l.id and c.excluido and c.excluido_em = l.excluido_em) as na,
             (select count(*) from public.comentarios c where c.locacao_id = l.id and c.excluido and c.excluido_em = l.excluido_em) as nc
    ) k
    where l.excluido

    union all
    select 'parcelas', pa.id,
           'Parcela ' || pa.numero || ' · R$ ' || translate(to_char(pa.valor, 'FM999,999,990.00'), ',.', '.,'),
           'Da ' || public.texto_reserva(pa.locacao_id),
           pa.excluido_por, pa.excluido_em
    from public.parcelas pa
    join public.locacoes l on l.id = pa.locacao_id
    where pa.excluido and not l.excluido

    union all
    select 'anexos', an.id, an.nome_arquivo,
           an.categoria || ' · da ' || public.texto_reserva(an.locacao_id),
           an.excluido_por, an.excluido_em
    from public.anexos an
    join public.locacoes l on l.id = an.locacao_id
    where an.excluido and not l.excluido

    union all
    select 'comentarios', co.id,
           case when length(co.texto) > 90 then left(co.texto, 90) || '…' else co.texto end,
           'Comentário de ' || coalesce(au.nome, '?') || ' na ' || public.texto_reserva(co.locacao_id),
           co.excluido_por, co.excluido_em
    from public.comentarios co
    join public.locacoes l on l.id = co.locacao_id
    left join public.usuarios au on au.id = co.autor_id
    where co.excluido and not l.excluido

    union all
    select 'pessoas', ps.id, ps.nome,
           case ps.tipo::text when 'locatario' then 'Locatário' when 'locador' then 'Locador' else 'Locatário e locador' end,
           ps.excluido_por, ps.excluido_em
    from public.pessoas ps
    where ps.excluido
  ) x
  left join public.usuarios u on u.id = x.excluido_por
  order by x.excluido_em desc nulls last;
end $$;

-- ---------------------------------------------------------------------
-- 5. Novidades
-- ---------------------------------------------------------------------
insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v0.4.0', '2026-11-15', array[
    'Pessoas: cadastro de locatários e locadores (a mesma pessoa pode ser os dois), com busca e filtro',
    'Reserva: locatário, locador, responsável, início e fim (padrão 00:00 às 23:59), status, valor e observações',
    'Reserva: aviso de conflito de horário antes de salvar, dizendo qual reserva ocupa a data',
    'Agenda: lista das próximas reservas por mês (as visões de calendário chegam nas próximas versões)'
  ])
on conflict (numero) do nothing;
