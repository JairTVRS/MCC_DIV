-- =====================================================================
-- v1.2.0 - Prazo de pagamento com parcelas "antes do evento"
-- Rode depois da 020: SQL Editor > New query > colar > Run.
--
-- * Cada parcela do prazo diz de onde contam os dias (campo "ref"):
--     "reserva" = dias após a pré-reserva (como sempre foi; vale quando o campo não vem)
--     "evento"  = dias antes do início do evento (0 = no dia do evento)
--   Ex.: [{dias 0, 30%}, {dias 15, 70%, ref evento}] -> "30% entrada + 70% 15 dias antes do evento".
-- * Ordem: primeiro as parcelas após a pré-reserva (dias crescentes), depois as antes do
--   evento (dias decrescentes: 30, depois 15...). Soma 100%, como antes.
-- * O nome gerado troca "antecipado" por "entrada" (pedido do Jair): todos os prazos são renomeados.
-- * parcelas.dias_antes_evento: a parcela do plano que conta do evento guarda os dias. Se a data
--   do evento mudar (arrastar na agenda ou editar a reserva), o banco move o vencimento das
--   parcelas em aberto: data do evento - dias, nunca antes da data da pré-reserva.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Nome do prazo (espelho das parcelas)
-- ---------------------------------------------------------------------
create or replace function public.nome_prazo(p_parcelas jsonb)
returns text language plpgsql immutable as $$
declare
  v_entrada numeric := 0;
  v_dias integer[] := '{}';
  v_pcts numeric[] := '{}';
  v_ev_dias integer[] := '{}';
  v_ev_pcts numeric[] := '{}';
  v_partes text[] := '{}';
  v_resto text;
  v_item jsonb;
  i integer;
begin
  for v_item in select * from jsonb_array_elements(p_parcelas) loop
    if coalesce(v_item ->> 'ref', 'reserva') = 'evento' then
      v_ev_dias := v_ev_dias || (v_item ->> 'dias')::integer;
      v_ev_pcts := v_ev_pcts || (v_item ->> 'percentual')::numeric;
    elsif (v_item ->> 'dias')::integer = 0 then
      v_entrada := v_entrada + (v_item ->> 'percentual')::numeric;
    else
      v_dias := v_dias || (v_item ->> 'dias')::integer;
      v_pcts := v_pcts || (v_item ->> 'percentual')::numeric;
    end if;
  end loop;

  if v_entrada > 0 and (cardinality(v_dias) > 0 or cardinality(v_ev_dias) > 0) then
    v_partes := v_partes || (public.fmt_pct(v_entrada) || '% entrada');
  end if;

  if cardinality(v_dias) > 0 then
    if cardinality(v_ev_dias) = 0 and cardinality(v_dias) = 1 then
      v_resto := v_dias[1] || ' dias';
    elsif cardinality(v_ev_dias) = 0 and (select max(x) - min(x) from unnest(v_pcts) x) <= 0.02 then
      v_resto := array_to_string(v_dias, '/');
    else
      -- Com parcelas antes do evento, cada parte mostra o seu % (para não confundir).
      v_resto := '';
      for i in 1 .. cardinality(v_dias) loop
        v_resto := v_resto || case when i > 1 then ' / ' else '' end || v_dias[i] || ' dias ' || public.fmt_pct(v_pcts[i]) || '%';
      end loop;
    end if;
    v_partes := v_partes || v_resto;
  end if;

  if cardinality(v_ev_dias) = 1 and cardinality(v_partes) = 0 then
    -- 100% numa parcela só, antes do evento.
    v_partes := v_partes || (case when v_ev_dias[1] = 0 then 'No dia do evento' else v_ev_dias[1] || ' dias antes do evento' end);
  else
    for i in 1 .. cardinality(v_ev_dias) loop
      v_partes := v_partes || (public.fmt_pct(v_ev_pcts[i]) || '% '
        || case when v_ev_dias[i] = 0 then 'no dia do evento' else v_ev_dias[i] || ' dias antes do evento' end);
    end loop;
  end if;

  if cardinality(v_partes) = 0 then
    return 'À vista';
  end if;
  return array_to_string(v_partes, ' + ');
end $$;

-- ---------------------------------------------------------------------
-- 2. Regras do prazo (gravadas sempre com "ref" em cada parcela)
-- ---------------------------------------------------------------------
create or replace function public.tg_prazos_regras()
returns trigger language plpgsql as $$
declare
  v_item jsonb;
  v_ref text;
  v_dias integer;
  v_soma numeric := 0;
  v_qtd integer;
  v_dias_ant integer := -1;
  v_ev_ant integer;
  v_fase text := 'reserva';
  v_novas jsonb := '[]';
begin
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
    v_ref := coalesce(v_item ->> 'ref', 'reserva');
    v_dias := (v_item ->> 'dias')::integer;
    if v_ref not in ('reserva', 'evento') then
      raise exception 'Cada parcela conta "após a pré-reserva" ou "antes do evento".';
    end if;
    if v_ref = 'reserva' then
      if v_fase = 'evento' then
        raise exception 'As parcelas após a pré-reserva vêm primeiro; as antes do evento ficam no fim.';
      end if;
      if v_dias <= v_dias_ant then
        raise exception 'Os dias das parcelas precisam ser crescentes, sem repetir.';
      end if;
      v_dias_ant := v_dias;
    else
      v_fase := 'evento';
      if v_ev_ant is not null and v_dias >= v_ev_ant then
        raise exception 'Os dias antes do evento precisam ser decrescentes, sem repetir (ex.: 30 e depois 15).';
      end if;
      v_ev_ant := v_dias;
    end if;
    v_soma := v_soma + (v_item ->> 'percentual')::numeric;
    v_novas := v_novas || jsonb_build_array(jsonb_build_object('dias', v_dias, 'percentual', (v_item ->> 'percentual')::numeric, 'ref', v_ref));
  end loop;
  if abs(v_soma - 100) > 0.01 then
    raise exception 'Os percentuais do prazo somam %; precisam somar 100%%.', round(v_soma, 2)::text || '%';
  end if;
  new.parcelas := v_novas;
  -- O nome é sempre o espelho das parcelas (o que vier digitado é ignorado).
  new.nome := public.nome_prazo(new.parcelas);
  return new;
end $$;

-- Todos os prazos ganham "ref" nas parcelas e o nome novo ("antecipado" -> "entrada").
update public.prazos_pagamento set parcelas = parcelas;

-- ---------------------------------------------------------------------
-- 3. Parcela do plano que conta do evento
-- ---------------------------------------------------------------------
alter table public.parcelas add column if not exists dias_antes_evento integer;
alter table public.parcelas drop constraint if exists parcelas_dias_antes_evento_check;
alter table public.parcelas add constraint parcelas_dias_antes_evento_check check (dias_antes_evento is null or dias_antes_evento >= 0);

-- Plano sempre pelo prazo: igual à 013, e cada parcela em aberto guarda os dias antes do
-- evento quando a parte do prazo correspondente conta do evento (posição: pagas + i).
create or replace function public.salvar_parcelas(p_locacao uuid, p_prazo uuid, p_parcelas jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_loc public.locacoes;
  v_prazo public.prazos_pagamento;
  v_item jsonb;
  v_parte jsonb;
  v_dias_ev integer;
  v_id uuid;
  v_manter uuid[] := '{}';
  v_n integer := 0;
  v_i integer := 0;
  v_qtd_pagas integer;
  v_pago numeric;
  v_soma numeric := 0;
  v_esperadas integer;
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
  select * into v_prazo from public.prazos_pagamento where id = p_prazo;
  if not found then
    raise exception 'Escolha um prazo de pagamento.';
  end if;
  if not v_prazo.ativo and v_prazo.id is distinct from v_loc.prazo_id then
    raise exception 'O prazo "%" está desativado.', v_prazo.nome;
  end if;
  if jsonb_typeof(p_parcelas) <> 'array' then
    raise exception 'Plano de parcelas inválido.';
  end if;

  -- Quantidade: parcelas novas + já pagas = parcelas do prazo.
  select count(*), coalesce(sum(valor), 0) into v_qtd_pagas, v_pago
  from public.parcelas where locacao_id = p_locacao and paga and not excluido;
  v_esperadas := jsonb_array_length(v_prazo.parcelas) - v_qtd_pagas;
  if jsonb_array_length(p_parcelas) <> v_esperadas then
    raise exception 'O prazo "%" tem % parcela(s); com % já paga(s), o plano precisa de exatamente % parcela(s) em aberto.',
      v_prazo.nome, jsonb_array_length(v_prazo.parcelas), v_qtd_pagas, greatest(v_esperadas, 0);
  end if;

  for v_item in select * from jsonb_array_elements(p_parcelas) loop
    if coalesce((v_item ->> 'valor')::numeric, 0) <= 0 or (v_item ->> 'vencimento') is null then
      raise exception 'Cada parcela precisa de valor maior que zero e vencimento.';
    end if;
    v_soma := v_soma + (v_item ->> 'valor')::numeric;
  end loop;

  -- Soma: já pago + parcelas novas = valor final.
  if abs(v_pago + v_soma - (v_loc.valor_total - v_loc.desconto)) > 0.01 then
    raise exception 'As parcelas somam R$ %, mas precisam fechar R$ % (valor final menos o já pago).',
      translate(to_char(v_soma, 'FM999,999,990.00'), ',.', '.,'),
      translate(to_char(v_loc.valor_total - v_loc.desconto - v_pago, 'FM999,999,990.00'), ',.', '.,');
  end if;

  for v_item in select * from jsonb_array_elements(p_parcelas) loop
    v_parte := v_prazo.parcelas -> (v_qtd_pagas + v_i);
    v_dias_ev := case when coalesce(v_parte ->> 'ref', 'reserva') = 'evento' then (v_parte ->> 'dias')::integer end;
    v_i := v_i + 1;
    v_id := nullif(v_item ->> 'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.parcelas where id = v_id and locacao_id = p_locacao
                                     and not paga and not encerrada and not excluido) then
      update public.parcelas
      set valor = (v_item ->> 'valor')::numeric,
          vencimento = (v_item ->> 'vencimento')::date,
          forma_pagamento_id = nullif(v_item ->> 'forma_pagamento_id', '')::uuid,
          tipo = coalesce(v_item ->> 'tipo', 'parcela'),
          dias_antes_evento = v_dias_ev
      where id = v_id;
    else
      insert into public.parcelas (locacao_id, numero, tipo, valor, vencimento, forma_pagamento_id, dias_antes_evento)
      values (p_locacao, 0, coalesce(v_item ->> 'tipo', 'parcela'), (v_item ->> 'valor')::numeric,
              (v_item ->> 'vencimento')::date, nullif(v_item ->> 'forma_pagamento_id', '')::uuid, v_dias_ev)
      returning id into v_id;
    end if;
    v_manter := v_manter || v_id;
  end loop;

  perform set_config('app.operacao_interna', 'on', true);
  -- Em aberto que saíram do plano: substituídas (fora da lixeira, mas no histórico).
  update public.parcelas set excluido = true, substituida = true
  where locacao_id = p_locacao and not paga and not encerrada and not excluido and not (id = any (v_manter));
  -- Numeração 1, 2, 3… por vencimento (pagas incluídas).
  for r in select id from public.parcelas where locacao_id = p_locacao and not excluido order by vencimento, numero, criado_em loop
    v_n := v_n + 1;
    update public.parcelas set numero = v_n where id = r.id and numero is distinct from v_n;
  end loop;
  perform set_config('app.operacao_interna', 'off', true);

  update public.locacoes set prazo_id = p_prazo where id = p_locacao and prazo_id is distinct from p_prazo;
end $$;

grant execute on function public.salvar_parcelas(uuid, uuid, jsonb) to authenticated;
revoke execute on function public.salvar_parcelas(uuid, uuid, jsonb) from public, anon;

-- ---------------------------------------------------------------------
-- 4. Evento mudou de dia: parcelas "antes do evento" em aberto acompanham
-- ---------------------------------------------------------------------
create or replace function public.tg_locacoes_vencimentos_evento()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_dia date := (new.inicio at time zone 'America/Sao_Paulo')::date;
  v_base date := (new.pre_reserva_em at time zone 'America/Sao_Paulo')::date;
  v_n integer := 0;
  r record;
begin
  if new.excluido or new.status_compromisso = 'cancelado'
     or v_dia = (old.inicio at time zone 'America/Sao_Paulo')::date then
    return new;
  end if;
  perform set_config('app.operacao_interna', 'on', true);
  -- Data do evento menos os dias, nunca antes da data da pré-reserva (a data base do plano).
  update public.parcelas p
  set vencimento = greatest(v_dia - p.dias_antes_evento, coalesce(v_base, v_dia - p.dias_antes_evento))
  where p.locacao_id = new.id and p.dias_antes_evento is not null and not p.paga and not p.encerrada and not p.excluido
    and p.vencimento is distinct from greatest(v_dia - p.dias_antes_evento, coalesce(v_base, v_dia - p.dias_antes_evento));
  if found then
    -- Numeração 1, 2, 3… por vencimento (como no plano).
    for r in select id from public.parcelas where locacao_id = new.id and not excluido order by vencimento, numero, criado_em loop
      v_n := v_n + 1;
      update public.parcelas set numero = v_n where id = r.id and numero is distinct from v_n;
    end loop;
  end if;
  perform set_config('app.operacao_interna', 'off', true);
  return new;
end $$;

drop trigger if exists vencimentos_evento on public.locacoes;
create trigger vencimentos_evento after update of inicio on public.locacoes
  for each row execute function public.tg_locacoes_vencimentos_evento();

-- ---------------------------------------------------------------------
-- 5. Novidades
-- ---------------------------------------------------------------------
insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v1.2.0', '2026-11-16', array[
    'Prazo de pagamento com parcelas "antes do evento" (ex.: 30% entrada + 70% 15 dias antes do evento)',
    'Arrastar ou mudar a data da reserva move junto os vencimentos "antes do evento" em aberto (com aviso antes de gravar)',
    'Nome dos prazos: "antecipado" passou a ser "entrada"'
  ])
on conflict (numero) do nothing;
