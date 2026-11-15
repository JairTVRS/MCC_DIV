-- =====================================================================
-- v0.7.0 - Desconto total também deixa a reserva Reservado
-- Rode depois da 013: SQL Editor > New query > colar > Run.
--
-- Regra do Jair: com 100% de desconto não há nada a pagar (pagamento = Pago), então a
-- reserva já é Reservado, como quando um valor é pago. Se a data estiver ocupada por outra
-- pré-reserva/reserva, o desconto não é gravado e a mensagem diz qual reserva ocupa a data.
-- =====================================================================
create or replace function public.recalcular_status_pagamento(p_locacao uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_loc public.locacoes;
  v_total numeric;
  v_final numeric;
  v_pago numeric;
  v_devolvido numeric;
  v_qtd_dev integer;
  v_novo public.status_pagamento;
  v_conflito text;
begin
  select * into v_loc from public.locacoes where id = p_locacao;
  if not found then return; end if;
  v_total := v_loc.valor_total;
  v_final := v_loc.valor_total - v_loc.desconto;

  select coalesce(sum(valor), 0) into v_pago from public.parcelas where locacao_id = p_locacao and paga and not excluido;
  select coalesce(sum(valor_devolvido), 0), count(*) into v_devolvido, v_qtd_dev from public.devolucoes where locacao_id = p_locacao;

  if v_loc.status_compromisso = 'cancelado' and v_qtd_dev > 0 then
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

  -- Desconto total (nada a pagar): a reserva vira Reservado, como num pagamento.
  if v_total > 0 and v_final <= 0 and not v_loc.excluido and v_loc.status_compromisso in ('cadastrado', 'pre_reserva') then
    begin
      update public.locacoes set status_compromisso = 'reservado' where id = p_locacao;
    exception when exclusion_violation then
      select public.texto_reserva(a.id) || ' (' || to_char(a.inicio at time zone 'America/Sao_Paulo', 'HH24:MI')
             || ' às ' || to_char(a.fim at time zone 'America/Sao_Paulo', 'HH24:MI') || ')'
        into v_conflito
      from public.locacoes a
      where a.id <> v_loc.id and not a.excluido and a.espaco_id = v_loc.espaco_id
        and a.status_compromisso in ('pre_reserva', 'reservado') and a.periodo && v_loc.periodo
      order by a.inicio limit 1;
      raise exception 'Com desconto total a reserva vira Reservado, e a data já está ocupada pela %.', coalesce(v_conflito, 'outra reserva');
    end;
  end if;
  perform set_config('app.operacao_interna', 'off', true);
end $$;
revoke execute on function public.recalcular_status_pagamento(uuid) from public, anon, authenticated;
