-- =====================================================================
-- v1.2.0 - Plano de pagamento: parcelas casadas com o prazo pelo tipo
-- Rode depois da 021: SQL Editor > New query > colar > Run.
--
-- Correção achada no teste do Jair: com o prazo "30 dias 50% + 50% 2 dias antes do evento", a
-- parcela antes do evento vence primeiro e vira a 1ª. A 021 casava as parcelas com o prazo pela
-- posição (pagas + i), então uma paga ou um plano refeito podia levar o "antes do evento" para a
-- parcela errada. Agora as pagas saem do prazo pelo tipo (paga com dias_antes_evento tira uma parte
-- antes do evento; as outras, partes após a pré-reserva) e o plano chega na ordem do prazo.
-- =====================================================================

-- Partes do prazo que ainda faltam pagar, na ordem do prazo (mesma regra de partesRestantes no app).
create or replace function public.partes_restantes(p_parcelas jsonb, p_locacao uuid)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_r jsonb := '[]';
  v_ev jsonb := '[]';
  v_out jsonb := '[]';
  v_item jsonb;
  v_pe integer;
  v_pr integer;
  v_nr integer;
  v_ne integer;
  i integer;
begin
  for v_item in select * from jsonb_array_elements(p_parcelas) loop
    if coalesce(v_item ->> 'ref', 'reserva') = 'evento' then
      v_ev := v_ev || jsonb_build_array(v_item);
    else
      v_r := v_r || jsonb_build_array(v_item);
    end if;
  end loop;
  select count(*) filter (where dias_antes_evento is not null), count(*) filter (where dias_antes_evento is null)
    into v_pe, v_pr
  from public.parcelas where locacao_id = p_locacao and paga and not excluido;
  v_nr := jsonb_array_length(v_r);
  v_ne := jsonb_array_length(v_ev);
  -- Paga de um tipo sem parte desse tipo sobrando (ex.: trocou de prazo): desconta do outro.
  if v_pr > v_nr then
    v_pe := v_pe + v_pr - v_nr;
    v_pr := v_nr;
  end if;
  if v_pe > v_ne then
    v_pr := least(v_nr, v_pr + v_pe - v_ne);
    v_pe := v_ne;
  end if;
  for i in v_pr .. v_nr - 1 loop
    v_out := v_out || jsonb_build_array(v_r -> i);
  end loop;
  for i in v_pe .. v_ne - 1 loop
    v_out := v_out || jsonb_build_array(v_ev -> i);
  end loop;
  return v_out;
end $$;
revoke execute on function public.partes_restantes(jsonb, uuid) from public, anon, authenticated;

-- Igual à 021, trocando a posição (pagas + i) pelas partes restantes.
create or replace function public.salvar_parcelas(p_locacao uuid, p_prazo uuid, p_parcelas jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_loc public.locacoes;
  v_prazo public.prazos_pagamento;
  v_restantes jsonb;
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

  -- O plano chega na ordem do prazo: a i-ésima parcela é a i-ésima parte que ainda falta.
  v_restantes := public.partes_restantes(v_prazo.parcelas, p_locacao);
  for v_item in select * from jsonb_array_elements(p_parcelas) loop
    v_parte := v_restantes -> v_i;
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
