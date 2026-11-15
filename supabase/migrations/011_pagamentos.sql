-- =====================================================================
-- v0.7.0 - Pagamento: prazos, parcelas, reservado automático e devolução (etapa 7)
-- Rode depois da 010: SQL Editor > New query > colar > Run.
--
-- Regras do Jair (15/11/2026):
-- * Cadastrado = só cadastro na agenda; Pré-reserva = sinal combinado para segurar a data;
--   Reservado = data confirmada, cliente já pagou tudo ou parte.
-- * Os dias dos prazos contam a partir da entrada em Pré-reserva (locacoes.pre_reserva_em).
-- * Qualquer valor pago => a reserva vira Reservado sozinha (bloqueia a data).
--   Pagamento desfeito e nada mais pago => volta para Cadastrado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Prazos de pagamento (cadastro em Configurações)
-- ---------------------------------------------------------------------
create table public.prazos_pagamento (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) between 1 and 60),
  -- [{"dias": 0, "percentual": 50}, {"dias": 30, "percentual": 16.67}, ...]
  parcelas jsonb not null,
  ativo boolean not null default true,
  ordem integer not null default 0
);
create unique index prazos_pagamento_nome_unico on public.prazos_pagamento (lower(trim(nome)));

-- Parcelas do prazo: de 1 a 36, dias inteiros >= 0 em ordem, percentuais > 0 somando 100%.
create or replace function public.tg_prazos_regras()
returns trigger language plpgsql as $$
declare
  v_item jsonb;
  v_soma numeric := 0;
  v_qtd integer;
  v_dias_ant integer := -1;
begin
  new.nome := trim(new.nome);
  if jsonb_typeof(new.parcelas) <> 'array' then
    raise exception 'Parcelas do prazo inválidas.';
  end if;
  v_qtd := jsonb_array_length(new.parcelas);
  if v_qtd < 1 or v_qtd > 36 then
    raise exception 'O prazo precisa ter de 1 a 36 parcelas.';
  end if;
  for v_item in select * from jsonb_array_elements(new.parcelas) loop
    if jsonb_typeof(v_item -> 'dias') <> 'number' or jsonb_typeof(v_item -> 'percentual') <> 'number'
       or (v_item ->> 'dias')::numeric <> trunc((v_item ->> 'dias')::numeric) or (v_item ->> 'dias')::integer < 0
       or (v_item ->> 'percentual')::numeric <= 0 then
      raise exception 'Cada parcela precisa de dias (0 ou mais) e percentual maior que zero.';
    end if;
    if (v_item ->> 'dias')::integer < v_dias_ant then
      raise exception 'As parcelas precisam estar em ordem de dias.';
    end if;
    v_dias_ant := (v_item ->> 'dias')::integer;
    v_soma := v_soma + (v_item ->> 'percentual')::numeric;
  end loop;
  if abs(v_soma - 100) > 0.01 then
    raise exception 'Os percentuais do prazo somam %; precisam somar 100%%.', round(v_soma, 2)::text || '%';
  end if;
  return new;
end $$;

create trigger regras before insert or update on public.prazos_pagamento
  for each row execute function public.tg_prazos_regras();
create trigger log after insert or update or delete on public.prazos_pagamento
  for each row execute function public.tg_log();

insert into public.prazos_pagamento (nome, parcelas, ordem) values
  ('À vista', '[{"dias": 0, "percentual": 100}]', 1),
  ('30 dias', '[{"dias": 30, "percentual": 100}]', 2),
  ('50% antecipado + 30/60/90', '[{"dias": 0, "percentual": 50}, {"dias": 30, "percentual": 16.67}, {"dias": 60, "percentual": 16.67}, {"dias": 90, "percentual": 16.66}]', 3),
  ('30/45/60', '[{"dias": 30, "percentual": 33.33}, {"dias": 45, "percentual": 33.33}, {"dias": 60, "percentual": 33.34}]', 4);

-- Árvore: Configurações > Prazos de pagamento (liberado para quem já cuidava das formas de pagamento).
update public.funcoes set ordem = 95 where codigo = 'configuracoes.lixeira';
insert into public.funcoes (codigo, pai, tipo, rotulo, descricao, ordem)
values ('configuracoes.prazos', 'configuracoes', 'funcao', 'Prazos de pagamento', 'Cadastro de prazos como "30 dias" ou "50% antecipado + 30/60/90".', 94);
insert into public.grupo_funcoes (perfil_id, funcao)
select perfil_id, 'configuracoes.prazos' from public.grupo_funcoes where funcao = 'configuracoes.formas_pagamento'
on conflict do nothing;

alter table public.prazos_pagamento enable row level security;
create policy "prazos: ativos leem" on public.prazos_pagamento for select using (public.usuario_ativo());
create policy "prazos: incluir" on public.prazos_pagamento for insert with check (public.tem_funcao('configuracoes.prazos'));
create policy "prazos: alterar" on public.prazos_pagamento for update using (public.tem_funcao('configuracoes.prazos'));
revoke delete on public.prazos_pagamento from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Reserva: quando entrou em Pré-reserva (data base dos prazos)
-- ---------------------------------------------------------------------
alter table public.locacoes add column if not exists pre_reserva_em timestamptz;
update public.locacoes set pre_reserva_em = coalesce(alterado_em, criado_em)
where status_compromisso = 'pre_reserva' and pre_reserva_em is null;

create or replace function public.tg_locacoes_pre_reserva()
returns trigger language plpgsql as $$
begin
  if new.status_compromisso = 'pre_reserva'
     and (tg_op = 'INSERT' or old.status_compromisso is distinct from 'pre_reserva') then
    new.pre_reserva_em := now();
  elsif tg_op = 'UPDATE' then
    new.pre_reserva_em := old.pre_reserva_em; -- só o banco preenche
  end if;
  return new;
end $$;

create trigger pre_reserva before insert or update on public.locacoes
  for each row execute function public.tg_locacoes_pre_reserva();

-- ---------------------------------------------------------------------
-- 2b. Desconto na reserva: valor final = valor da locação - desconto (até 100%)
-- ---------------------------------------------------------------------
alter table public.locacoes add column if not exists desconto numeric(12, 2) not null default 0;
alter table public.locacoes add column if not exists motivo_desconto text;

insert into public.funcoes (codigo, pai, tipo, rotulo, descricao, ordem)
values ('pagamentos.desconto', 'pagamentos', 'funcao', 'Conceder desconto', 'Dar desconto no valor da locação (com motivo, registrado no histórico).', 28);
insert into public.grupo_funcoes (perfil_id, funcao)
select id, 'pagamentos.desconto' from public.perfis where nome = 'Gestor'
on conflict do nothing;

create or replace function public.tg_locacoes_desconto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.motivo_desconto := nullif(trim(new.motivo_desconto), '');
  if new.desconto < 0 then
    raise exception 'O desconto não pode ser negativo.';
  end if;
  if new.desconto > new.valor_total then
    raise exception 'O desconto não pode ser maior que o valor da locação.';
  end if;
  if new.desconto = 0 then
    new.motivo_desconto := null;
  end if;
  if auth.uid() is not null and not public.em_operacao_interna()
     and (new.desconto is distinct from (case when tg_op = 'INSERT' then 0 else old.desconto end)
          or new.motivo_desconto is distinct from (case when tg_op = 'INSERT' then null else old.motivo_desconto end))
     and not public.tem_funcao('pagamentos.desconto') then
    raise exception 'Seu grupo não pode conceder desconto.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger desconto before insert or update on public.locacoes
  for each row execute function public.tg_locacoes_desconto();

-- Reserva nova já nasce com o status de pagamento certo (ex.: desconto de 100% = Pago).
create or replace function public.tg_locacoes_criada()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recalcular_status_pagamento(new.id);
  return new;
end $$;

create trigger recalcular_ao_criar after insert on public.locacoes
  for each row execute function public.tg_locacoes_criada();

-- Status de pagamento sobre o valor final (com desconto). Desconto total = nada a pagar = Pago.
create or replace function public.recalcular_status_pagamento(p_locacao uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_final numeric;
  v_status public.status_compromisso;
  v_pago numeric;
  v_devolvido numeric;
  v_qtd_dev integer;
  v_novo public.status_pagamento;
begin
  select valor_total, valor_total - desconto, status_compromisso into v_total, v_final, v_status from public.locacoes where id = p_locacao;
  if not found then return; end if;

  select coalesce(sum(valor), 0) into v_pago from public.parcelas where locacao_id = p_locacao and paga and not excluido;
  select coalesce(sum(valor_devolvido), 0), count(*) into v_devolvido, v_qtd_dev from public.devolucoes where locacao_id = p_locacao;

  if v_status = 'cancelado' and v_qtd_dev > 0 then
    v_novo := case when v_devolvido >= v_pago then 'devolvido' else 'devolvido_parcial' end;
  elsif v_total > 0 and v_final <= 0 then
    v_novo := 'pago';
  elsif v_pago <= 0 then
    v_novo := 'pendente';
  elsif v_pago >= v_final then
    v_novo := 'pago';
  else
    v_novo := 'parcial';
  end if;

  perform set_config('app.operacao_interna', 'on', true);
  update public.locacoes set status_pagamento = v_novo where id = p_locacao and status_pagamento is distinct from v_novo;
  perform set_config('app.operacao_interna', 'off', true);
end $$;
revoke execute on function public.recalcular_status_pagamento(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Parcelas: quem marca pago, parcela substituída, encerrada ou de reserva cancelada
-- ---------------------------------------------------------------------
alter table public.parcelas add column if not exists substituida boolean not null default false;

create or replace function public.tg_parcelas_regras()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status public.status_compromisso;
begin
  if auth.uid() is not null and not public.em_operacao_interna() then
    if new.paga is distinct from (case when tg_op = 'INSERT' then false else old.paga end)
       and not public.tem_acao('marcar_pago') then
      raise exception 'Seu grupo não pode marcar parcelas como pagas.' using errcode = '42501';
    end if;
    -- Quem só marca pagamento (sem "Alterar pagamentos") mexe apenas em paga, data, forma e comprovante.
    if tg_op = 'UPDATE' and not public.tem_permissao('pagamentos', 'alterar')
       and (new.valor is distinct from old.valor or new.vencimento is distinct from old.vencimento
            or new.numero is distinct from old.numero or new.tipo is distinct from old.tipo
            or new.encerrada is distinct from old.encerrada) then
      raise exception 'Seu grupo só pode registrar o pagamento, não alterar a parcela.' using errcode = '42501';
    end if;
    if new.paga and (tg_op = 'INSERT' or not old.paga) then
      select status_compromisso into v_status from public.locacoes where id = new.locacao_id;
      if v_status = 'cancelado' then
        raise exception 'A reserva está cancelada: não dá para registrar pagamento.';
      end if;
      if new.encerrada then
        raise exception 'Esta parcela foi encerrada no cancelamento.';
      end if;
    end if;
  end if;
  if new.paga and new.pago_em is null then
    new.pago_em := (now() at time zone 'America/Sao_Paulo')::date;
  elsif not new.paga then
    new.pago_em := null;
  end if;
  return new;
end $$;

drop policy if exists "parcelas: alterar" on public.parcelas;
create policy "parcelas: alterar" on public.parcelas for update
  using (public.tem_permissao('pagamentos', 'alterar') or public.tem_acao('marcar_pago') or public.tem_acao('restaurar_lixeira'));

-- ---------------------------------------------------------------------
-- 4. Reservado automático: pagou algo => Reservado; desfez e nada pago => Cadastrado
-- ---------------------------------------------------------------------
create or replace function public.tg_parcelas_compromisso()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_loc public.locacoes;
  v_pago numeric;
  v_conflito text;
  v_era_paga boolean := case when tg_op = 'INSERT' then false else old.paga end;
begin
  if new.paga is not distinct from v_era_paga then
    return new;
  end if;
  select * into v_loc from public.locacoes where id = new.locacao_id;
  if v_loc.excluido then
    return new;
  end if;

  if new.paga and v_loc.status_compromisso in ('cadastrado', 'pre_reserva') then
    perform set_config('app.operacao_interna', 'on', true);
    begin
      update public.locacoes set status_compromisso = 'reservado' where id = v_loc.id;
    exception when exclusion_violation then
      select public.texto_reserva(a.id) || ' (' || to_char(a.inicio at time zone 'America/Sao_Paulo', 'HH24:MI')
             || ' às ' || to_char(a.fim at time zone 'America/Sao_Paulo', 'HH24:MI') || ')'
        into v_conflito
      from public.locacoes a
      where a.id <> v_loc.id and not a.excluido and a.espaco_id = v_loc.espaco_id
        and a.status_compromisso in ('pre_reserva', 'reservado') and a.periodo && v_loc.periodo
      order by a.inicio limit 1;
      raise exception 'Não dá para registrar o pagamento: com ele a reserva vira Reservado, e a data já está ocupada pela %.',
        coalesce(v_conflito, 'outra reserva');
    end;
    perform set_config('app.operacao_interna', 'off', true);
  elsif not new.paga and v_loc.status_compromisso = 'reservado' then
    select coalesce(sum(valor), 0) into v_pago from public.parcelas where locacao_id = v_loc.id and paga and not excluido;
    if v_pago = 0 then
      perform set_config('app.operacao_interna', 'on', true);
      update public.locacoes set status_compromisso = 'cadastrado' where id = v_loc.id;
      perform set_config('app.operacao_interna', 'off', true);
    end if;
  end if;
  return new;
end $$;

create trigger compromisso after insert or update of paga on public.parcelas
  for each row execute function public.tg_parcelas_compromisso();

-- ---------------------------------------------------------------------
-- 5. Plano de parcelas: grava de uma vez as parcelas em aberto
-- ---------------------------------------------------------------------
-- p_parcelas: [{"id": <uuid ou null>, "valor": 1000, "vencimento": "2026-12-01",
--               "forma_pagamento_id": <uuid ou null>, "tipo": "entrada"|"parcela"}]
-- Parcelas pagas ou encerradas não mudam. As em aberto que não vierem na lista saem
-- (substituídas: ficam no histórico, não vão para a lixeira). Depois renumera por vencimento.
create or replace function public.salvar_parcelas(p_locacao uuid, p_parcelas jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_loc public.locacoes;
  v_item jsonb;
  v_id uuid;
  v_manter uuid[] := '{}';
  v_n integer := 0;
  r record;
begin
  if not (public.tem_permissao('pagamentos', 'incluir') and public.tem_permissao('pagamentos', 'alterar')) then
    raise exception 'Seu grupo não pode montar o plano de pagamento.' using errcode = '42501';
  end if;
  select * into v_loc from public.locacoes where id = p_locacao and not excluido;
  if not found then
    raise exception 'Reserva não encontrada.';
  end if;
  if v_loc.status_compromisso = 'cancelado' then
    raise exception 'A reserva está cancelada: o plano de pagamento não pode mudar.';
  end if;
  if jsonb_typeof(p_parcelas) <> 'array' or jsonb_array_length(p_parcelas) > 36 then
    raise exception 'Plano de parcelas inválido.';
  end if;

  for v_item in select * from jsonb_array_elements(p_parcelas) loop
    if coalesce((v_item ->> 'valor')::numeric, -1) < 0 or (v_item ->> 'vencimento') is null then
      raise exception 'Cada parcela precisa de valor e vencimento.';
    end if;
    v_id := nullif(v_item ->> 'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.parcelas where id = v_id and locacao_id = p_locacao
                                     and not paga and not encerrada and not excluido) then
      update public.parcelas
      set valor = (v_item ->> 'valor')::numeric,
          vencimento = (v_item ->> 'vencimento')::date,
          forma_pagamento_id = nullif(v_item ->> 'forma_pagamento_id', '')::uuid,
          tipo = coalesce(v_item ->> 'tipo', 'parcela')
      where id = v_id;
    else
      insert into public.parcelas (locacao_id, numero, tipo, valor, vencimento, forma_pagamento_id)
      values (p_locacao, 0, coalesce(v_item ->> 'tipo', 'parcela'), (v_item ->> 'valor')::numeric,
              (v_item ->> 'vencimento')::date, nullif(v_item ->> 'forma_pagamento_id', '')::uuid)
      returning id into v_id;
    end if;
    v_manter := v_manter || v_id;
  end loop;

  -- Em aberto que saíram do plano: substituídas (fora da lixeira, mas no histórico).
  perform set_config('app.operacao_interna', 'on', true);
  update public.parcelas set excluido = true, substituida = true
  where locacao_id = p_locacao and not paga and not encerrada and not excluido and not (id = any (v_manter));

  -- Numeração 1, 2, 3… por vencimento (pagas incluídas).
  for r in select id from public.parcelas where locacao_id = p_locacao and not excluido order by vencimento, numero, criado_em loop
    v_n := v_n + 1;
    update public.parcelas set numero = v_n where id = r.id and numero is distinct from v_n;
  end loop;
  perform set_config('app.operacao_interna', 'off', true);
end $$;

grant execute on function public.salvar_parcelas(uuid, jsonb) to authenticated;
revoke execute on function public.salvar_parcelas(uuid, jsonb) from public, anon;

-- ---------------------------------------------------------------------
-- 6. Lixeira: parcelas substituídas pelo plano não aparecem
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
      select (select count(*) from public.parcelas c where c.locacao_id = l.id and c.excluido and not c.substituida and c.excluido_em = l.excluido_em) as np,
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
    where pa.excluido and not pa.substituida and not l.excluido

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

-- Restaurar uma reserva não traz de volta parcelas substituídas pelo plano.
create or replace function public.tg_locacoes_depois()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.operacao_interna', 'on', true);

  if new.excluido and not old.excluido then
    update public.parcelas set excluido = true where locacao_id = new.id and not excluido;
    update public.anexos set excluido = true where locacao_id = new.id and not excluido;
    update public.comentarios set excluido = true where locacao_id = new.id and not excluido;
  elsif old.excluido and not new.excluido then
    update public.parcelas set excluido = false where locacao_id = new.id and excluido and not substituida and excluido_em = old.excluido_em;
    update public.anexos set excluido = false where locacao_id = new.id and excluido and excluido_em = old.excluido_em;
    update public.comentarios set excluido = false where locacao_id = new.id and excluido and excluido_em = old.excluido_em;
  end if;

  if new.status_compromisso = 'cancelado' and old.status_compromisso <> 'cancelado' then
    update public.parcelas set encerrada = true where locacao_id = new.id and not paga and not encerrada;
  elsif old.status_compromisso = 'cancelado' and new.status_compromisso <> 'cancelado' then
    update public.parcelas set encerrada = false where locacao_id = new.id and encerrada;
  end if;

  perform set_config('app.operacao_interna', 'off', true);

  if new.valor_total is distinct from old.valor_total or new.desconto is distinct from old.desconto
     or new.status_compromisso is distinct from old.status_compromisso then
    perform public.recalcular_status_pagamento(new.id);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 7. Comprovantes: anexo ligado à parcela ou à devolução
-- ---------------------------------------------------------------------
-- Quem registra o pagamento ou a devolução também pode anexar o comprovante e ligá-lo.
drop policy if exists "anexos: incluir" on public.anexos;
create policy "anexos: incluir" on public.anexos for insert with check (
  public.tem_permissao('anexos', 'incluir')
  or (categoria = 'Comprovante' and (public.tem_acao('marcar_pago') or public.tem_acao('registrar_devolucao')))
);
drop policy if exists "anexos: enviar arquivo" on storage.objects;
create policy "anexos: enviar arquivo" on storage.objects for insert with check (
  bucket_id = 'anexos'
  and (public.tem_permissao('anexos', 'incluir') or public.tem_acao('marcar_pago') or public.tem_acao('registrar_devolucao'))
);
drop policy if exists "anexos: ler arquivo" on storage.objects;
create policy "anexos: ler arquivo" on storage.objects for select using (
  bucket_id = 'anexos' and (public.tem_permissao('anexos', 'visualizar') or public.tem_permissao('pagamentos', 'visualizar'))
);
drop policy if exists "anexos: ler" on public.anexos;
create policy "anexos: ler" on public.anexos for select using (
  (public.tem_permissao('anexos', 'visualizar') or (categoria = 'Comprovante' and public.tem_permissao('pagamentos', 'visualizar')))
  and (not excluido or public.tem_acao('restaurar_lixeira'))
);

-- ---------------------------------------------------------------------
-- 8. Novidades
-- ---------------------------------------------------------------------
insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v0.7.0', '2026-11-15', array[
    'Configurações: prazos de pagamento (ex.: 30 dias, 50% antecipado + 30/60/90, 30/45/60)',
    'Reserva > Pagamento: parcelas geradas pelo prazo a partir da data da pré-reserva, editáveis uma a uma',
    'Marcar parcela como paga com data, forma e comprovante; qualquer valor pago deixa a reserva Reservado',
    'Pagamento desfeito sem nada mais pago: a reserva volta para Cadastrado',
    'Cancelamento com valor recebido pede o registro da devolução (total ou parcial, com comprovante)',
    'Reserva: desconto em R$ (até o valor total) com motivo; pagamento e parcelas usam o valor final'
  ])
on conflict (numero) do nothing;
