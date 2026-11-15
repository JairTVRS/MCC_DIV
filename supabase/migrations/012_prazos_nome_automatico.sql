-- =====================================================================
-- v0.7.0 - Prazos de pagamento: nome gerado das parcelas (espelho)
-- Rode depois da 011: SQL Editor > New query > colar > Run.
--
-- O nome do prazo deixa de ser digitado: o banco monta a partir das parcelas, para o
-- nome nunca contradizer o que foi cadastrado. Prazo igual a outro já existente é recusado.
--   100% na hora                    -> "À vista"
--   uma parcela                     -> "30 dias"
--   partes iguais                   -> "30/60/90"
--   com antecipado (0 dias)         -> "30% antecipado + 30/60/90"
--   partes diferentes               -> "30 dias 40% / 60 dias 60%"
-- Os dias precisam ser crescentes (sem repetir) e cada parcela precisa de % maior que zero.
-- =====================================================================

-- 12.5 -> "12,5" ; 50.00 -> "50"
create or replace function public.fmt_pct(p numeric)
returns text language sql immutable as $$
  select replace(rtrim(rtrim(round(p, 2)::text, '0'), '.'), '.', ',')
$$;

create or replace function public.nome_prazo(p_parcelas jsonb)
returns text language plpgsql immutable as $$
declare
  v_antecipado numeric := 0;
  v_dias integer[] := '{}';
  v_pcts numeric[] := '{}';
  v_item jsonb;
  v_resto text;
  i integer;
begin
  for v_item in select * from jsonb_array_elements(p_parcelas) loop
    if (v_item ->> 'dias')::integer = 0 then
      v_antecipado := v_antecipado + (v_item ->> 'percentual')::numeric;
    else
      v_dias := v_dias || (v_item ->> 'dias')::integer;
      v_pcts := v_pcts || (v_item ->> 'percentual')::numeric;
    end if;
  end loop;

  if coalesce(array_length(v_dias, 1), 0) = 0 then
    return 'À vista';
  elsif array_length(v_dias, 1) = 1 then
    v_resto := v_dias[1] || ' dias';
  elsif (select max(x) - min(x) from unnest(v_pcts) x) <= 0.02 then
    v_resto := array_to_string(v_dias, '/');
  else
    v_resto := '';
    for i in 1 .. array_length(v_dias, 1) loop
      v_resto := v_resto || case when i > 1 then ' / ' else '' end || v_dias[i] || ' dias ' || public.fmt_pct(v_pcts[i]) || '%';
    end loop;
  end if;

  if v_antecipado > 0 then
    return public.fmt_pct(v_antecipado) || '% antecipado + ' || v_resto;
  end if;
  return v_resto;
end $$;

create or replace function public.tg_prazos_regras()
returns trigger language plpgsql as $$
declare
  v_item jsonb;
  v_soma numeric := 0;
  v_qtd integer;
  v_dias_ant integer := -1;
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
    if (v_item ->> 'dias')::integer <= v_dias_ant then
      raise exception 'Os dias das parcelas precisam ser crescentes, sem repetir.';
    end if;
    v_dias_ant := (v_item ->> 'dias')::integer;
    v_soma := v_soma + (v_item ->> 'percentual')::numeric;
  end loop;
  if abs(v_soma - 100) > 0.01 then
    raise exception 'Os percentuais do prazo somam %; precisam somar 100%%.', round(v_soma, 2)::text || '%';
  end if;
  -- O nome é sempre o espelho das parcelas (o que vier digitado é ignorado).
  new.nome := public.nome_prazo(new.parcelas);
  return new;
end $$;

-- Prazos já cadastrados ganham o nome gerado. Se dois tiverem exatamente as mesmas parcelas,
-- o repetido sai (nada aponta para prazos: a reserva guarda as parcelas geradas, não o prazo).
do $$
declare
  r record;
begin
  for r in select id from public.prazos_pagamento order by ordem, nome loop
    begin
      update public.prazos_pagamento set parcelas = parcelas where id = r.id;
    exception when unique_violation then
      delete from public.prazos_pagamento where id = r.id;
      raise notice 'Prazo % tinha as mesmas parcelas de outro e foi removido.', r.id;
    end;
  end loop;
end $$;
