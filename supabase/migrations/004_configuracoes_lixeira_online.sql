-- =====================================================================
-- v0.2.0 - Configurações, lixeira, avatar e usuários online
-- Rode depois das migrações v0.1.x: SQL Editor > New query > colar > Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Log: trocar o tema ou abrir as novidades não é alteração de cadastro
-- ---------------------------------------------------------------------
create or replace function public.tg_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_id text;
  v_loc uuid;
  k text;
  v_ignorar text[] := array['alterado_em', 'alterado_por', 'excluido', 'excluido_por', 'excluido_em', 'periodo', 'criado_em', 'criado_por', 'registrado_em', 'registrado_por', 'enviado_em', 'enviado_por'];
begin
  -- Preferências pessoais não poluem o log de administração de usuários.
  if tg_table_name = 'usuarios' then
    v_ignorar := v_ignorar || array['tema_preferido', 'ultima_versao_vista'];
  end if;

  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('UPDATE', 'INSERT') then v_new := to_jsonb(new); end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id');
  v_loc := case
             when tg_table_name = 'locacoes' then v_id::uuid
             else nullif(coalesce(v_new ->> 'locacao_id', v_old ->> 'locacao_id'), '')::uuid
           end;

  if tg_op = 'INSERT' then
    insert into public.log_eventos (tabela, registro_id, locacao_id, usuario_id, acao)
    values (tg_table_name, v_id, v_loc, auth.uid(), 'criou');
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.log_eventos (tabela, registro_id, locacao_id, usuario_id, acao)
    values (tg_table_name, v_id, v_loc, auth.uid(), 'apagou');
    return old;
  end if;

  if (v_old ->> 'excluido') is distinct from (v_new ->> 'excluido') then
    insert into public.log_eventos (tabela, registro_id, locacao_id, usuario_id, acao)
    values (tg_table_name, v_id, v_loc, auth.uid(), case when (v_new ->> 'excluido')::boolean then 'excluiu' else 'restaurou' end);
  end if;

  for k in select jsonb_object_keys(v_new) loop
    continue when k = any (v_ignorar);
    if (v_old -> k) is distinct from (v_new -> k) then
      insert into public.log_eventos (tabela, registro_id, locacao_id, usuario_id, acao, campo, valor_anterior, valor_novo)
      values (tg_table_name, v_id, v_loc, auth.uid(), 'alterou', k, v_old ->> k, v_new ->> k);
    end if;
  end loop;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Usuários: nome só com liberação do administrador; foto só da própria pasta
-- ---------------------------------------------------------------------
create or replace function public.tg_usuarios_regras()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.id is distinct from old.id or new.email is distinct from old.email or new.solicitado_em is distinct from old.solicitado_em then
    raise exception 'Estes dados do usuário não podem ser alterados.' using errcode = '42501';
  end if;

  if public.tem_acao('administrar_usuarios') then
    if new.id = auth.uid() and (new.status_acesso is distinct from old.status_acesso or new.perfil_id is distinct from old.perfil_id) then
      raise exception 'Você não pode alterar o próprio acesso ou perfil.' using errcode = '42501';
    end if;
    if new.status_acesso = 'ativo' and new.perfil_id is null then
      raise exception 'Escolha um perfil antes de liberar o acesso.';
    end if;
  else
    if new.id <> auth.uid() then
      raise exception 'Sem permissão para alterar outro usuário.' using errcode = '42501';
    end if;
    if new.status_acesso is distinct from old.status_acesso
       or new.perfil_id is distinct from old.perfil_id
       or new.motivo_recusa is distinct from old.motivo_recusa
       or new.decidido_por is distinct from old.decidido_por
       or new.decidido_em is distinct from old.decidido_em then
      raise exception 'Só um administrador pode alterar acesso e perfil.' using errcode = '42501';
    end if;
    if new.nome is distinct from old.nome or new.foto_google is distinct from old.foto_google then
      raise exception 'Só um administrador pode alterar o nome do usuário.' using errcode = '42501';
    end if;
  end if;

  new.nome := trim(new.nome);
  if new.nome = '' then
    raise exception 'O nome não pode ficar em branco.';
  end if;

  -- A foto enviada precisa estar na pasta do próprio usuário no bucket de avatares.
  if new.foto_upload is distinct from old.foto_upload and new.foto_upload is not null
     and position('/storage/v1/object/public/avatares/' || new.id::text || '/' in new.foto_upload) = 0 then
    raise exception 'Endereço de foto inválido.';
  end if;
  if new.foto_upload is null then
    new.usar_foto_upload := false;
  end if;

  if new.status_acesso is distinct from old.status_acesso then
    new.decidido_por := auth.uid();
    new.decidido_em := now();
    if new.status_acesso <> 'recusado' then
      new.motivo_recusa := null;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3. Configurações: nome limpo e imagens só do bucket "marca"
-- ---------------------------------------------------------------------
create or replace function public.tg_configuracoes_regras()
returns trigger language plpgsql as $$
begin
  new.nome_app := nullif(trim(new.nome_app), '');
  if length(new.nome_app) > 60 then
    raise exception 'O nome do app pode ter até 60 caracteres.';
  end if;
  if (new.logo_claro is not null and position('/storage/v1/object/public/marca/' in new.logo_claro) = 0)
     or (new.logo_escuro is not null and position('/storage/v1/object/public/marca/' in new.logo_escuro) = 0)
     or (new.favicon is not null and position('/storage/v1/object/public/marca/' in new.favicon) = 0) then
    raise exception 'Endereço de imagem inválido.';
  end if;
  return new;
end $$;

create trigger regras before update on public.configuracoes for each row execute function public.tg_configuracoes_regras();

-- ---------------------------------------------------------------------
-- 4. Formas de pagamento: nome preenchido e sem repetir (ignorando maiúsculas)
-- ---------------------------------------------------------------------
alter table public.formas_pagamento
  add constraint formas_pagamento_nome_valido check (length(trim(nome)) between 1 and 40);
create unique index formas_pagamento_nome_unico on public.formas_pagamento (lower(trim(nome)));

-- ---------------------------------------------------------------------
-- 5. Lixeira
-- ---------------------------------------------------------------------

-- "reserva de Fulano em 21/11/2026": usado na lixeira e nas mensagens de conflito.
create or replace function public.texto_reserva(p_locacao uuid)
returns text language sql stable security definer set search_path = public as $$
  select 'reserva de ' || pe.nome || ' em ' || to_char(l.inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
  from public.locacoes l
  join public.pessoas pe on pe.id = l.locatario_id
  where l.id = p_locacao
$$;

-- Tudo que está na lixeira, numa lista só. Itens que saíram junto com uma reserva
-- não aparecem soltos: ficam dentro dela e voltam quando ela for restaurada.
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
           case ps.tipo when 'locatario' then 'Locatário' else 'Locador' end,
           ps.excluido_por, ps.excluido_em
    from public.pessoas ps
    where ps.excluido
  ) x
  left join public.usuarios u on u.id = x.excluido_por
  order by x.excluido_em desc nulls last;
end $$;

-- Restaurar: item de reserva excluída espera a reserva voltar; conflito de horário vira mensagem clara.
create or replace function public.restaurar_registro(p_tabela text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_modulo text := public.modulo_da_tabela(p_tabela);
  v_qtd integer;
  v_loc uuid;
  v_conflito text;
begin
  if v_modulo is null then raise exception 'Tipo de registro inválido: %', p_tabela; end if;
  if not public.tem_acao('restaurar_lixeira') then
    raise exception 'Só quem tem acesso à lixeira pode restaurar.' using errcode = '42501';
  end if;

  if p_tabela in ('parcelas', 'anexos', 'comentarios') then
    execute format('select locacao_id from public.%I where id = $1', p_tabela) into v_loc using p_id;
    if exists (select 1 from public.locacoes where id = v_loc and excluido) then
      raise exception 'Este item é de uma reserva que está na lixeira. Restaure a reserva primeiro.';
    end if;
  end if;

  begin
    execute format('update public.%I set excluido = false where id = $1 and excluido', p_tabela) using p_id;
    get diagnostics v_qtd = row_count;
  exception when exclusion_violation then
    select public.texto_reserva(a.id) || ' (' || to_char(a.inicio at time zone 'America/Sao_Paulo', 'HH24:MI')
           || ' às ' || to_char(a.fim at time zone 'America/Sao_Paulo', 'HH24:MI') || ')'
      into v_conflito
    from public.locacoes a
    join public.locacoes b on b.id = p_id
    where a.id <> b.id and not a.excluido and a.espaco_id = b.espaco_id
      and a.status_compromisso in ('pre_reserva', 'reservado') and a.periodo && b.periodo
    order by a.inicio
    limit 1;
    raise exception 'Não dá para restaurar: o horário já está ocupado pela %. Mude o horário de uma das reservas e tente de novo.',
      coalesce(v_conflito, 'outra reserva');
  end;

  if v_qtd = 0 then raise exception 'Registro não encontrado na lixeira.'; end if;
end $$;

grant execute on function public.listar_lixeira() to authenticated;
revoke execute on function public.listar_lixeira() from public, anon;
revoke execute on function public.texto_reserva(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Arquivos: apagar a foto ou o logo antigo exige também permissão de leitura no Storage
-- ---------------------------------------------------------------------
create policy "avatares: ler propria pasta" on storage.objects for select
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "marca: ler" on storage.objects for select
  using (bucket_id = 'marca' and public.tem_permissao('configuracoes', 'alterar'));

-- ---------------------------------------------------------------------
-- 7. Usuários online: canal privado de presença, só para usuário ativo
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'realtime' and table_name = 'messages') then
    execute 'drop policy if exists "online: ativos veem" on realtime.messages';
    execute 'drop policy if exists "online: ativos aparecem" on realtime.messages';
    execute $p$create policy "online: ativos veem" on realtime.messages for select to authenticated
      using (realtime.messages.extension = 'presence' and (select realtime.topic()) = 'online' and public.usuario_ativo())$p$;
    execute $p$create policy "online: ativos aparecem" on realtime.messages for insert to authenticated
      with check (realtime.messages.extension = 'presence' and (select realtime.topic()) = 'online' and public.usuario_ativo())$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Novidades
-- ---------------------------------------------------------------------
insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v0.2.0', '2026-11-13', array[
    'Configurações: nome e logo do app (versões para fundo claro e escuro), com ícone da aba gerado sozinho',
    'Configurações: formas de pagamento (incluir, renomear, ativar/desativar e ordenar)',
    'Configurações: lixeira com tudo que foi excluído e botão Restaurar',
    'Menu do avatar: Meu perfil e Trocar foto, com recorte quadrado e volta para a foto do Google',
    'Contador de usuários online ao lado da versão',
    'Página de política de privacidade'
  ])
on conflict (numero) do nothing;
