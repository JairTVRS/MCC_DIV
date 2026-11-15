-- =====================================================================
-- v0.3.0 - Grupos de usuários e árvore de permissões (etapa 3)
-- Rode depois da 006: SQL Editor > New query > colar > Run.
--
-- * Os perfis viram "grupos" (no banco a tabela continua "perfis" e a coluna "perfil_id").
--   Cada usuário pertence a um único grupo.
-- * As permissões passam a ser uma árvore módulo > função (tabela "funcoes")
--   liberada por grupo (tabela "grupo_funcoes"). Substitui "permissoes" + "perfil_acoes",
--   com as permissões de hoje copiadas.
-- * tem_permissao(modulo, acao) e tem_acao(acao) continuam existindo e passam a ler a árvore,
--   então as regras de reservas, pagamentos e lixeira não mudam.
-- * O grupo Administrador (perfis.sistema) tem sempre todas as funções e não pode ser
--   renomeado, editado nem excluído. Só administradores mexem em administradores.
--   Ninguém altera o próprio acesso ou grupo: quem age é sempre um administrador ativo,
--   então nunca fica o sistema sem administrador.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Grupos
-- ---------------------------------------------------------------------
alter table public.perfis add column if not exists sistema boolean not null default false;
update public.perfis set sistema = true where nome = 'Administrador';
create unique index if not exists perfis_um_sistema on public.perfis (sistema) where sistema;
alter table public.perfis add constraint perfis_nome_valido check (length(trim(nome)) between 1 and 40);

-- ---------------------------------------------------------------------
-- 2. Árvore de funções e funções liberadas por grupo
-- ---------------------------------------------------------------------
create table public.funcoes (
  codigo text primary key,
  pai text references public.funcoes (codigo) on delete cascade,
  tipo text not null check (tipo in ('modulo', 'funcao')),
  rotulo text not null,
  descricao text,
  ordem integer not null default 0
);

create table public.grupo_funcoes (
  perfil_id uuid not null references public.perfis (id) on delete cascade,
  funcao text not null references public.funcoes (codigo) on delete cascade,
  primary key (perfil_id, funcao)
);
create index grupo_funcoes_funcao_idx on public.grupo_funcoes (funcao);

-- Função liberada para o usuário logado (ativo).
create or replace function public.tem_funcao(p_funcao text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.usuarios u
    join public.grupo_funcoes g on g.perfil_id = u.perfil_id
    where u.id = auth.uid() and u.status_acesso = 'ativo' and g.funcao = p_funcao
  )
$$;

-- Regras ao liberar/retirar funções de um grupo.
create or replace function public.tg_grupo_funcoes_regras()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_grupo uuid := coalesce(new.perfil_id, old.perfil_id);
  v_funcao text := coalesce(new.funcao, old.funcao);
begin
  if tg_op = 'INSERT' and not exists (select 1 from public.funcoes where codigo = new.funcao and tipo = 'funcao') then
    raise exception 'Só funções podem ser liberadas (não módulos).';
  end if;
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if exists (select 1 from public.perfis where id = v_grupo and sistema) then
    raise exception 'O grupo Administrador sempre tem todas as permissões.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' and v_funcao = 'usuarios.grupos'
     and exists (select 1 from public.usuarios where id = auth.uid() and perfil_id = v_grupo) then
    raise exception 'Você não pode tirar do seu próprio grupo a permissão de gerenciar grupos.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

create trigger regras before insert or delete on public.grupo_funcoes
  for each row execute function public.tg_grupo_funcoes_regras();

-- Log: "liberou" / "retirou" com o código da função.
create or replace function public.tg_log_grupo_funcoes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.log_eventos (tabela, registro_id, usuario_id, acao, campo, valor_novo)
    values ('grupo_funcoes', new.perfil_id::text, auth.uid(), 'liberou', 'funcao', new.funcao);
    return new;
  end if;
  insert into public.log_eventos (tabela, registro_id, usuario_id, acao, campo, valor_anterior)
  values ('grupo_funcoes', old.perfil_id::text, auth.uid(), 'retirou', 'funcao', old.funcao);
  return old;
end $$;

create trigger log after insert or delete on public.grupo_funcoes
  for each row execute function public.tg_log_grupo_funcoes();

-- Toda função nova da árvore já nasce liberada para o grupo Administrador.
create or replace function public.tg_funcoes_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tipo = 'funcao' then
    insert into public.grupo_funcoes (perfil_id, funcao)
    select id, new.codigo from public.perfis where sistema
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger admin_tem_tudo after insert on public.funcoes
  for each row execute function public.tg_funcoes_admin();

-- Grupos: Administrador intocável; grupo com usuários não é excluído.
create or replace function public.tg_perfis_regras()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_qtd integer;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.sistema then
      raise exception 'O grupo Administrador não pode ser excluído.' using errcode = '42501';
    end if;
    select count(*) into v_qtd from public.usuarios where perfil_id = old.id;
    if v_qtd > 0 then
      raise exception 'Este grupo tem % usuário(s). Mude-os de grupo antes de excluir.', v_qtd;
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.sistema := false;
  elsif old.sistema then
    if new.nome is distinct from old.nome or new.sistema is distinct from old.sistema then
      raise exception 'O grupo Administrador não pode ser renomeado.' using errcode = '42501';
    end if;
  elsif new.sistema then
    raise exception 'Só existe um grupo Administrador.' using errcode = '42501';
  end if;
  new.nome := trim(new.nome);
  new.descricao := nullif(trim(new.descricao), '');
  return new;
end $$;

create trigger regras before insert or update or delete on public.perfis
  for each row execute function public.tg_perfis_regras();

-- ---------------------------------------------------------------------
-- 3. A árvore (ordem = ordem na tela)
-- ---------------------------------------------------------------------
insert into public.funcoes (codigo, pai, tipo, rotulo, descricao, ordem) values
  ('agenda', null, 'modulo', 'Agenda', 'Reservas e tudo que fica dentro delas.', 10),
  ('reservas.visualizar', 'agenda', 'funcao', 'Visualizar', null, 11),
  ('reservas.incluir', 'agenda', 'funcao', 'Incluir', null, 12),
  ('reservas.alterar', 'agenda', 'funcao', 'Alterar', null, 13),
  ('reservas.excluir', 'agenda', 'funcao', 'Excluir', null, 14),
  ('reservas.confirmar', 'agenda', 'funcao', 'Confirmar reserva', 'Mudar o status para Reservado.', 15),
  ('reservas.cancelar', 'agenda', 'funcao', 'Cancelar reserva', 'Mudar o status para Cancelado.', 16),
  ('pagamentos', 'agenda', 'modulo', 'Pagamentos', null, 20),
  ('pagamentos.visualizar', 'pagamentos', 'funcao', 'Visualizar', null, 21),
  ('pagamentos.incluir', 'pagamentos', 'funcao', 'Incluir', null, 22),
  ('pagamentos.alterar', 'pagamentos', 'funcao', 'Alterar', null, 23),
  ('pagamentos.excluir', 'pagamentos', 'funcao', 'Excluir', null, 24),
  ('pagamentos.marcar_pago', 'pagamentos', 'funcao', 'Marcar parcela como paga', null, 25),
  ('pagamentos.registrar_devolucao', 'pagamentos', 'funcao', 'Registrar devolução', 'Devolução de valores no cancelamento.', 26),
  ('pagamentos.alertas', 'pagamentos', 'funcao', 'Receber alertas de vencimento', 'Aviso no sino 3 dias antes e no dia seguinte ao vencimento.', 27),
  ('anexos', 'agenda', 'modulo', 'Anexos', null, 30),
  ('anexos.visualizar', 'anexos', 'funcao', 'Visualizar', null, 31),
  ('anexos.incluir', 'anexos', 'funcao', 'Incluir', null, 32),
  ('anexos.alterar', 'anexos', 'funcao', 'Alterar', null, 33),
  ('anexos.excluir', 'anexos', 'funcao', 'Excluir', null, 34),
  ('comentarios', 'agenda', 'modulo', 'Comentários', null, 40),
  ('comentarios.visualizar', 'comentarios', 'funcao', 'Visualizar', null, 41),
  ('comentarios.incluir', 'comentarios', 'funcao', 'Incluir', null, 42),
  ('comentarios.alterar', 'comentarios', 'funcao', 'Alterar', 'Editar os próprios comentários.', 43),
  ('comentarios.excluir', 'comentarios', 'funcao', 'Excluir', null, 44),
  ('lista', null, 'modulo', 'Lista / Relatório', null, 50),
  ('lista.visualizar', 'lista', 'funcao', 'Visualizar', null, 51),
  ('lista.exportar', 'lista', 'funcao', 'Exportar', 'Baixar a lista em CSV/Excel.', 52),
  ('pessoas', null, 'modulo', 'Pessoas', 'Locatários e locadores.', 60),
  ('pessoas.visualizar', 'pessoas', 'funcao', 'Visualizar', null, 61),
  ('pessoas.incluir', 'pessoas', 'funcao', 'Incluir', null, 62),
  ('pessoas.alterar', 'pessoas', 'funcao', 'Alterar', null, 63),
  ('pessoas.excluir', 'pessoas', 'funcao', 'Excluir', null, 64),
  ('usuarios', null, 'modulo', 'Usuários e Grupos', null, 70),
  ('usuarios.visualizar', 'usuarios', 'funcao', 'Visualizar', 'Ver usuários e grupos.', 71),
  ('usuarios.aprovar', 'usuarios', 'funcao', 'Aprovar lista de espera', 'Aprovar ou recusar quem pediu acesso.', 72),
  ('usuarios.ativar', 'usuarios', 'funcao', 'Ativar e inativar', null, 73),
  ('usuarios.editar', 'usuarios', 'funcao', 'Editar nome e grupo', null, 74),
  ('usuarios.grupos', 'usuarios', 'funcao', 'Gerenciar grupos e permissões', 'Criar, renomear e excluir grupos e marcar a árvore.', 75),
  ('logs', null, 'modulo', 'Histórico (log)', null, 80),
  ('logs.reserva', 'logs', 'funcao', 'Histórico da reserva', null, 81),
  ('logs.usuario', 'logs', 'funcao', 'Histórico dos usuários', null, 82),
  ('logs.geral', 'logs', 'funcao', 'Log geral do sistema', null, 83),
  ('configuracoes', null, 'modulo', 'Configurações', null, 90),
  ('configuracoes.visualizar', 'configuracoes', 'funcao', 'Visualizar', 'Abrir a engrenagem.', 91),
  ('configuracoes.nome_logo', 'configuracoes', 'funcao', 'Nome, logo e ícone', null, 92),
  ('configuracoes.formas_pagamento', 'configuracoes', 'funcao', 'Formas de pagamento', null, 93),
  ('configuracoes.lixeira', 'configuracoes', 'funcao', 'Lixeira (ver e restaurar)', null, 94),
  ('online', null, 'modulo', 'Usuários online', null, 100),
  ('online.visualizar', 'online', 'funcao', 'Ver quem está online', 'Contador ao lado da versão.', 101);

-- ---------------------------------------------------------------------
-- 4. Cópia das permissões de hoje para a árvore
-- ---------------------------------------------------------------------
insert into public.grupo_funcoes (perfil_id, funcao)
select distinct x.perfil_id, x.funcao
from (
  select p.perfil_id, p.modulo || '.visualizar' as funcao from public.permissoes p where p.visualizar
  union all select p.perfil_id, p.modulo || '.incluir' from public.permissoes p where p.incluir
  union all select p.perfil_id, p.modulo || '.alterar' from public.permissoes p where p.alterar
  union all select p.perfil_id, p.modulo || '.excluir' from public.permissoes p where p.excluir
  -- "alterar configurações" vira as duas abas editáveis
  union all select p.perfil_id, 'configuracoes.nome_logo' from public.permissoes p where p.modulo = 'configuracoes' and p.alterar
  union all select p.perfil_id, 'configuracoes.formas_pagamento' from public.permissoes p where p.modulo = 'configuracoes' and p.alterar
  -- quem via reservas via a lista e o histórico delas
  union all select p.perfil_id, 'lista.visualizar' from public.permissoes p where p.modulo = 'reservas' and p.visualizar
  union all select p.perfil_id, 'logs.reserva' from public.permissoes p where p.modulo = 'reservas' and p.visualizar
  -- ações sensíveis
  union all select a.perfil_id,
         case a.acao
           when 'marcar_pago' then 'pagamentos.marcar_pago'
           when 'registrar_devolucao' then 'pagamentos.registrar_devolucao'
           when 'confirmar_reserva' then 'reservas.confirmar'
           when 'cancelar_reserva' then 'reservas.cancelar'
           when 'ver_log_geral' then 'logs.geral'
           when 'restaurar_lixeira' then 'configuracoes.lixeira'
         end
  from public.perfil_acoes a where a.acao <> 'administrar_usuarios'
  union all select a.perfil_id, f.codigo from public.perfil_acoes a
         cross join (values ('usuarios.aprovar'), ('usuarios.ativar'), ('usuarios.editar'), ('usuarios.grupos'), ('logs.usuario')) f (codigo)
         where a.acao = 'administrar_usuarios'
  -- até hoje todo usuário ativo via o contador online
  union all select id, 'online.visualizar' from public.perfis
  -- alertas de vencimento e exportação: administradores e gestores (como no plano)
  union all select id, 'pagamentos.alertas' from public.perfis where nome in ('Administrador', 'Gestor')
  union all select id, 'lista.exportar' from public.perfis where nome in ('Administrador', 'Gestor')
) x
where exists (select 1 from public.funcoes f where f.codigo = x.funcao and f.tipo = 'funcao')
on conflict do nothing;

-- O Administrador tem tudo (o gatilho da árvore já liberou; aqui só garante).
insert into public.grupo_funcoes (perfil_id, funcao)
select p.id, f.codigo from public.perfis p cross join public.funcoes f where p.sistema and f.tipo = 'funcao'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 5. Checagens antigas lendo a árvore (as regras que as usam não mudam)
-- ---------------------------------------------------------------------
create or replace function public.tem_permissao(p_modulo text, p_acao text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_modulo = 'configuracoes' and p_acao = 'alterar'
      then public.tem_funcao('configuracoes.nome_logo') or public.tem_funcao('configuracoes.formas_pagamento')
    else public.tem_funcao(p_modulo || '.' || p_acao)
  end
$$;

create or replace function public.tem_acao(p_acao text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.tem_funcao(case p_acao
    when 'marcar_pago' then 'pagamentos.marcar_pago'
    when 'registrar_devolucao' then 'pagamentos.registrar_devolucao'
    when 'confirmar_reserva' then 'reservas.confirmar'
    when 'cancelar_reserva' then 'reservas.cancelar'
    when 'ver_log_geral' then 'logs.geral'
    when 'administrar_usuarios' then 'usuarios.grupos'
    when 'restaurar_lixeira' then 'configuracoes.lixeira'
    else p_acao
  end)
$$;

-- ---------------------------------------------------------------------
-- 6. Funções que liam as tabelas antigas
-- ---------------------------------------------------------------------

-- Pedido de acesso: avisa quem pode aprovar a lista de espera.
create or replace function public.notificar_pedido_acesso(p_usuario uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.notificacoes (usuario_id, tipo, usuario_solicitante_id)
  select u.id, 'pedido_acesso', p_usuario
  from public.usuarios u
  join public.grupo_funcoes g on g.perfil_id = u.perfil_id and g.funcao = 'usuarios.aprovar'
  where u.status_acesso = 'ativo' and u.id <> p_usuario
$$;
revoke execute on function public.notificar_pedido_acesso(uuid) from public, anon, authenticated;

-- Primeiro login: o e-mail do primeiro administrador entra no grupo Administrador.
create or replace function public.tg_novo_usuario_auth()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_admin_email text;
  v_eh_admin boolean;
  v_grupo_admin uuid;
begin
  select admin_email into v_admin_email from public.config_privada where id = 1;
  v_eh_admin := v_admin_email is not null and lower(new.email) = lower(trim(v_admin_email));
  select id into v_grupo_admin from public.perfis where sistema;

  insert into public.usuarios (id, nome, email, foto_google, status_acesso, perfil_id, decidido_em)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    case when v_eh_admin then 'ativo' else 'pendente' end::public.status_acesso,
    case when v_eh_admin then v_grupo_admin end,
    case when v_eh_admin then now() end
  )
  on conflict (id) do nothing;

  if not v_eh_admin then
    perform public.notificar_pedido_acesso(new.id);
  end if;
  return new;
end $$;

-- Menções: só usuários ativos que veem reservas; gera alerta no sino.
create or replace function public.tg_mencoes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_comentario public.comentarios;
begin
  select * into v_comentario from public.comentarios where id = new.comentario_id;
  if auth.uid() is not null and v_comentario.autor_id <> auth.uid() then
    raise exception 'Só o autor do comentário pode marcar pessoas nele.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.usuarios u
    join public.grupo_funcoes g on g.perfil_id = u.perfil_id and g.funcao = 'reservas.visualizar'
    where u.id = new.usuario_mencionado_id and u.status_acesso = 'ativo'
  ) then
    raise exception 'Esse usuário não pode ser marcado.';
  end if;
  if new.usuario_mencionado_id <> v_comentario.autor_id then
    insert into public.notificacoes (usuario_id, tipo, locacao_id, comentario_id, usuario_solicitante_id)
    values (new.usuario_mencionado_id, 'mencao', v_comentario.locacao_id, v_comentario.id, v_comentario.autor_id);
  end if;
  return new;
end $$;

-- Alertas de vencimento: responsável da reserva + grupos com "Receber alertas de vencimento".
create or replace function public.gerar_alertas_vencimento()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_qtd integer;
begin
  with alvo as (
    select p.id as parcela_id, p.locacao_id, l.responsavel_id,
           case when p.vencimento = v_hoje + 3 then 'vencimento' else 'atraso' end::public.tipo_notificacao as tipo
    from public.parcelas p
    join public.locacoes l on l.id = p.locacao_id
    where not p.paga and not p.encerrada and not p.excluido
      and not l.excluido and l.status_compromisso <> 'cancelado'
      and (p.vencimento = v_hoje + 3 or p.vencimento = v_hoje - 1)
  ),
  destinatarios as (
    select a.*, a.responsavel_id as usuario_id from alvo a
    union
    select a.*, u.id from alvo a
    cross join public.usuarios u
    join public.grupo_funcoes g on g.perfil_id = u.perfil_id and g.funcao = 'pagamentos.alertas'
    where u.status_acesso = 'ativo'
  ),
  inseridos as (
    insert into public.notificacoes (usuario_id, tipo, locacao_id, parcela_id)
    select d.usuario_id, d.tipo, d.locacao_id, d.parcela_id
    from destinatarios d
    join public.usuarios u on u.id = d.usuario_id and u.status_acesso = 'ativo'
    where not exists (
      select 1 from public.notificacoes n
      where n.usuario_id = d.usuario_id and n.parcela_id = d.parcela_id and n.tipo = d.tipo
    )
    returning 1
  )
  select count(*) into v_qtd from inseridos;
  return v_qtd;
end $$;
revoke execute on function public.gerar_alertas_vencimento() from public, anon, authenticated;

-- Usuários: cada função da árvore libera uma parte; ninguém mexe no próprio acesso;
-- só administradores mexem em administradores.
create or replace function public.tg_usuarios_regras()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_aprovacao boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.id is distinct from old.id or new.email is distinct from old.email or new.solicitado_em is distinct from old.solicitado_em then
    raise exception 'Estes dados do usuário não podem ser alterados.' using errcode = '42501';
  end if;

  if new.id = auth.uid() then
    if new.status_acesso is distinct from old.status_acesso or new.perfil_id is distinct from old.perfil_id
       or new.motivo_recusa is distinct from old.motivo_recusa
       or new.decidido_por is distinct from old.decidido_por or new.decidido_em is distinct from old.decidido_em then
      raise exception 'Você não pode alterar o próprio acesso ou grupo.' using errcode = '42501';
    end if;
    if (new.nome is distinct from old.nome or new.foto_google is distinct from old.foto_google) and not public.tem_funcao('usuarios.editar') then
      raise exception 'Só um administrador pode alterar o nome do usuário.' using errcode = '42501';
    end if;
  else
    if new.foto_upload is distinct from old.foto_upload or new.usar_foto_upload is distinct from old.usar_foto_upload
       or new.tema_preferido is distinct from old.tema_preferido or new.ultima_versao_vista is distinct from old.ultima_versao_vista then
      raise exception 'Foto e preferências só podem ser alteradas pelo próprio usuário.' using errcode = '42501';
    end if;
    if (new.nome is distinct from old.nome or new.foto_google is distinct from old.foto_google) and not public.tem_funcao('usuarios.editar') then
      raise exception 'Seu grupo não pode editar dados de usuários.' using errcode = '42501';
    end if;

    v_aprovacao := old.status_acesso in ('pendente', 'recusado') and new.status_acesso is distinct from old.status_acesso;
    if new.status_acesso is distinct from old.status_acesso then
      if v_aprovacao then
        if new.status_acesso not in ('ativo', 'recusado') then
          raise exception 'Mudança de situação inválida.';
        end if;
        if not public.tem_funcao('usuarios.aprovar') then
          raise exception 'Seu grupo não pode aprovar ou recusar acessos.' using errcode = '42501';
        end if;
      elsif old.status_acesso in ('ativo', 'inativo') and new.status_acesso in ('ativo', 'inativo') then
        if not public.tem_funcao('usuarios.ativar') then
          raise exception 'Seu grupo não pode ativar ou inativar usuários.' using errcode = '42501';
        end if;
      else
        raise exception 'Mudança de situação inválida.';
      end if;
    end if;

    if new.motivo_recusa is distinct from old.motivo_recusa and new.status_acesso = 'recusado' and not public.tem_funcao('usuarios.aprovar') then
      raise exception 'Seu grupo não pode aprovar ou recusar acessos.' using errcode = '42501';
    end if;

    if new.perfil_id is distinct from old.perfil_id
       and not (v_aprovacao and new.status_acesso = 'ativo')
       and not public.tem_funcao('usuarios.editar') then
      raise exception 'Seu grupo não pode trocar o grupo de usuários.' using errcode = '42501';
    end if;

    if exists (select 1 from public.perfis where sistema and id in (old.perfil_id, new.perfil_id))
       and not exists (select 1 from public.usuarios u join public.perfis p on p.id = u.perfil_id where u.id = auth.uid() and p.sistema) then
      raise exception 'Só um administrador pode alterar administradores.' using errcode = '42501';
    end if;

    if new.status_acesso = 'ativo' and new.perfil_id is null then
      raise exception 'Escolha um grupo antes de liberar o acesso.';
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

  -- Quem decidiu e quando: preenchidos pelo banco.
  new.decidido_por := old.decidido_por;
  new.decidido_em := old.decidido_em;
  if new.status_acesso is distinct from old.status_acesso then
    new.decidido_por := auth.uid();
    new.decidido_em := now();
  end if;
  if new.status_acesso <> 'recusado' then
    new.motivo_recusa := null;
  else
    new.motivo_recusa := nullif(trim(new.motivo_recusa), '');
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 7. Segurança por linha
-- ---------------------------------------------------------------------
alter table public.funcoes enable row level security;
alter table public.grupo_funcoes enable row level security;

create policy "funcoes: ativos leem" on public.funcoes for select using (public.usuario_ativo());
create policy "grupo_funcoes: ativos leem" on public.grupo_funcoes for select using (public.usuario_ativo());
create policy "grupo_funcoes: liberar" on public.grupo_funcoes for insert with check (public.tem_funcao('usuarios.grupos'));
create policy "grupo_funcoes: retirar" on public.grupo_funcoes for delete using (public.tem_funcao('usuarios.grupos'));
revoke insert, update, delete on public.funcoes from anon, authenticated;
revoke update on public.grupo_funcoes from anon, authenticated;

drop policy if exists "perfis: admin gerencia" on public.perfis;
create policy "perfis: incluir" on public.perfis for insert with check (public.tem_funcao('usuarios.grupos'));
create policy "perfis: alterar" on public.perfis for update using (public.tem_funcao('usuarios.grupos')) with check (public.tem_funcao('usuarios.grupos'));
create policy "perfis: excluir" on public.perfis for delete using (public.tem_funcao('usuarios.grupos'));

drop policy if exists "usuarios: alterar" on public.usuarios;
create policy "usuarios: alterar" on public.usuarios for update
  using (id = auth.uid() or public.tem_funcao('usuarios.aprovar') or public.tem_funcao('usuarios.ativar') or public.tem_funcao('usuarios.editar'))
  with check (id = auth.uid() or public.tem_funcao('usuarios.aprovar') or public.tem_funcao('usuarios.ativar') or public.tem_funcao('usuarios.editar'));

drop policy if exists "configuracoes: alterar" on public.configuracoes;
create policy "configuracoes: alterar" on public.configuracoes for update
  using (public.tem_funcao('configuracoes.nome_logo')) with check (public.tem_funcao('configuracoes.nome_logo'));

drop policy if exists "formas_pagamento: incluir" on public.formas_pagamento;
drop policy if exists "formas_pagamento: alterar" on public.formas_pagamento;
create policy "formas_pagamento: incluir" on public.formas_pagamento for insert with check (public.tem_funcao('configuracoes.formas_pagamento'));
create policy "formas_pagamento: alterar" on public.formas_pagamento for update using (public.tem_funcao('configuracoes.formas_pagamento'));

drop policy if exists "marca: enviar" on storage.objects;
drop policy if exists "marca: trocar" on storage.objects;
drop policy if exists "marca: remover" on storage.objects;
drop policy if exists "marca: ler" on storage.objects;
create policy "marca: enviar" on storage.objects for insert with check (bucket_id = 'marca' and public.tem_funcao('configuracoes.nome_logo'));
create policy "marca: trocar" on storage.objects for update using (bucket_id = 'marca' and public.tem_funcao('configuracoes.nome_logo'));
create policy "marca: remover" on storage.objects for delete using (bucket_id = 'marca' and public.tem_funcao('configuracoes.nome_logo'));
create policy "marca: ler" on storage.objects for select using (bucket_id = 'marca' and public.tem_funcao('configuracoes.nome_logo'));

drop policy if exists "log: ler" on public.log_eventos;
create policy "log: ler" on public.log_eventos for select using (
  public.tem_funcao('logs.geral')
  or (locacao_id is not null and public.tem_funcao('logs.reserva'))
  or (tabela in ('usuarios', 'grupo_funcoes', 'perfis') and public.tem_funcao('logs.usuario'))
);

-- Usuários online: só quem tem "Ver quem está online" entra no canal (e aparece nele).
do $$
begin
  if to_regclass('realtime.messages') is null then
    return;
  end if;
  execute 'drop policy if exists "online: ativos veem" on realtime.messages';
  execute 'drop policy if exists "online: ativos aparecem" on realtime.messages';
  execute $p$create policy "online: ativos veem" on realtime.messages for select to authenticated
    using ((select realtime.topic()) = 'online'
           and realtime.messages.extension in ('broadcast', 'presence')
           and public.tem_funcao('online.visualizar'))$p$;
  execute $p$create policy "online: ativos aparecem" on realtime.messages for insert to authenticated
    with check ((select realtime.topic()) = 'online'
                and realtime.messages.extension in ('broadcast', 'presence')
                and public.tem_funcao('online.visualizar'))$p$;
end $$;

-- ---------------------------------------------------------------------
-- 8. Tabelas antigas saem (tudo já está na árvore)
-- ---------------------------------------------------------------------
drop table public.perfil_acoes;
drop table public.permissoes;

-- ---------------------------------------------------------------------
-- 9. Novidades
-- ---------------------------------------------------------------------
insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v0.3.0', '2026-11-15', array[
    'Usuários e Grupos: lista de espera para aprovar ou recusar quem pediu acesso, escolhendo o grupo',
    'Usuários: busca, filtros por situação, ativar e inativar, editar nome e trocar de grupo',
    'Grupos: criar, renomear e excluir grupos e marcar as permissões numa árvore por módulo e função',
    'Número de pessoas na lista de espera no menu'
  ])
on conflict (numero) do nothing;
