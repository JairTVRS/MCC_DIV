-- =====================================================================
-- v0.1.0 - Estrutura inicial do banco (Plano Agenda de Locações v1.8)
-- Executar uma vez no Supabase: SQL Editor > New query > colar > Run.
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- 1. Tipos
-- ---------------------------------------------------------------------
create type public.status_acesso as enum ('pendente', 'ativo', 'inativo', 'recusado');
create type public.status_compromisso as enum ('cadastrado', 'pre_reserva', 'reservado', 'cancelado');
create type public.status_pagamento as enum ('pendente', 'parcial', 'pago', 'devolvido', 'devolvido_parcial');
create type public.tipo_pessoa as enum ('locatario', 'locador');
create type public.tipo_notificacao as enum ('mencao', 'pedido_acesso', 'vencimento', 'atraso');

-- ---------------------------------------------------------------------
-- 2. Tabelas
-- ---------------------------------------------------------------------

-- Configuração privada: nunca é lida pelo app, só por funções do banco.
create table public.config_privada (
  id smallint primary key default 1 check (id = 1),
  admin_email text
);
insert into public.config_privada (id) values (1);

create table public.perfis (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  descricao text,
  criado_em timestamptz not null default now()
);

create table public.permissoes (
  id uuid primary key default gen_random_uuid(),
  perfil_id uuid not null references public.perfis (id) on delete cascade,
  modulo text not null check (modulo in ('reservas', 'pagamentos', 'anexos', 'comentarios', 'pessoas', 'usuarios', 'logs', 'configuracoes')),
  visualizar boolean not null default false,
  incluir boolean not null default false,
  alterar boolean not null default false,
  excluir boolean not null default false,
  unique (perfil_id, modulo)
);

-- Ações sensíveis, com permissão própria além do CRUD.
create table public.perfil_acoes (
  perfil_id uuid not null references public.perfis (id) on delete cascade,
  acao text not null check (acao in ('marcar_pago', 'registrar_devolucao', 'confirmar_reserva', 'cancelar_reserva', 'ver_log_geral', 'administrar_usuarios', 'restaurar_lixeira')),
  primary key (perfil_id, acao)
);

create table public.usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null default '',
  email text not null unique,
  status_acesso public.status_acesso not null default 'pendente',
  perfil_id uuid references public.perfis (id),
  solicitado_em timestamptz not null default now(),
  decidido_por uuid references public.usuarios (id),
  decidido_em timestamptz,
  motivo_recusa text,
  foto_google text,
  foto_upload text,
  usar_foto_upload boolean not null default false,
  tema_preferido text not null default 'sistema' check (tema_preferido in ('sistema', 'claro', 'escuro')),
  ultima_versao_vista text,
  criado_em timestamptz not null default now()
);

create table public.configuracoes (
  id smallint primary key default 1 check (id = 1),
  nome_app text,
  logo_claro text,
  logo_escuro text,
  favicon text,
  alterado_por uuid references public.usuarios (id),
  alterado_em timestamptz
);
insert into public.configuracoes (id) values (1);

create table public.formas_pagamento (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ativo boolean not null default true,
  ordem integer not null default 0
);

create table public.espacos (
  id uuid primary key default gen_random_uuid(),
  nome text not null
);

create or replace function public.espaco_padrao()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.espacos order by nome limit 1
$$;

create table public.pessoas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  tipo public.tipo_pessoa not null,
  telefone text,
  email text,
  documento text,
  criado_por uuid references public.usuarios (id),
  criado_em timestamptz not null default now(),
  alterado_por uuid references public.usuarios (id),
  alterado_em timestamptz,
  excluido boolean not null default false,
  excluido_por uuid references public.usuarios (id),
  excluido_em timestamptz
);

create table public.locacoes (
  id uuid primary key default gen_random_uuid(),
  espaco_id uuid not null default public.espaco_padrao() references public.espacos (id),
  locatario_id uuid not null references public.pessoas (id),
  locador_id uuid not null references public.pessoas (id),
  responsavel_id uuid not null default auth.uid() references public.usuarios (id),
  inicio timestamptz not null,
  fim timestamptz not null,
  periodo tstzrange generated always as (tstzrange(inicio, fim, '[)')) stored,
  status_compromisso public.status_compromisso not null default 'cadastrado',
  valor_total numeric(12, 2) not null default 0 check (valor_total >= 0),
  status_pagamento public.status_pagamento not null default 'pendente',
  observacoes text,
  criado_por uuid references public.usuarios (id),
  criado_em timestamptz not null default now(),
  alterado_por uuid references public.usuarios (id),
  alterado_em timestamptz,
  excluido boolean not null default false,
  excluido_por uuid references public.usuarios (id),
  excluido_em timestamptz,
  constraint locacoes_fim_apos_inicio check (fim > inicio),
  -- Pré-reserva e reservado não podem se sobrepor. Cadastrado, cancelado e excluído ficam fora.
  constraint locacoes_sem_conflito exclude using gist (espaco_id with =, periodo with &&)
    where (not excluido and status_compromisso in ('pre_reserva', 'reservado'))
);

create table public.parcelas (
  id uuid primary key default gen_random_uuid(),
  locacao_id uuid not null references public.locacoes (id),
  numero integer not null,
  tipo text not null default 'parcela' check (tipo in ('entrada', 'parcela')),
  valor numeric(12, 2) not null check (valor >= 0),
  vencimento date not null,
  forma_pagamento_id uuid references public.formas_pagamento (id),
  paga boolean not null default false,
  pago_em date,
  comprovante_id uuid,
  encerrada boolean not null default false,
  criado_por uuid references public.usuarios (id),
  criado_em timestamptz not null default now(),
  alterado_por uuid references public.usuarios (id),
  alterado_em timestamptz,
  excluido boolean not null default false,
  excluido_por uuid references public.usuarios (id),
  excluido_em timestamptz
);

create table public.devolucoes (
  id uuid primary key default gen_random_uuid(),
  locacao_id uuid not null references public.locacoes (id),
  valor_devolvido numeric(12, 2) not null check (valor_devolvido >= 0),
  valor_retido numeric(12, 2) not null default 0,
  data date not null default current_date,
  forma_pagamento_id uuid references public.formas_pagamento (id),
  motivo text,
  comprovante_id uuid,
  registrado_por uuid references public.usuarios (id),
  registrado_em timestamptz not null default now(),
  alterado_por uuid references public.usuarios (id),
  alterado_em timestamptz
);

create table public.anexos (
  id uuid primary key default gen_random_uuid(),
  locacao_id uuid not null references public.locacoes (id),
  parcela_id uuid references public.parcelas (id),
  devolucao_id uuid references public.devolucoes (id),
  nome_arquivo text not null,
  caminho_storage text not null,
  categoria text not null default 'Documento',
  tamanho bigint not null check (tamanho <= 20971520),
  enviado_por uuid references public.usuarios (id),
  enviado_em timestamptz not null default now(),
  excluido boolean not null default false,
  excluido_por uuid references public.usuarios (id),
  excluido_em timestamptz
);

alter table public.parcelas add constraint parcelas_comprovante_fk foreign key (comprovante_id) references public.anexos (id);
alter table public.devolucoes add constraint devolucoes_comprovante_fk foreign key (comprovante_id) references public.anexos (id);

create table public.comentarios (
  id uuid primary key default gen_random_uuid(),
  locacao_id uuid not null references public.locacoes (id),
  texto text not null check (length(trim(texto)) > 0),
  autor_id uuid not null default auth.uid() references public.usuarios (id),
  criado_em timestamptz not null default now(),
  editado_em timestamptz,
  excluido boolean not null default false,
  excluido_por uuid references public.usuarios (id),
  excluido_em timestamptz
);

create table public.comentario_mencoes (
  id uuid primary key default gen_random_uuid(),
  comentario_id uuid not null references public.comentarios (id),
  usuario_mencionado_id uuid not null references public.usuarios (id),
  unique (comentario_id, usuario_mencionado_id)
);

create table public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  tipo public.tipo_notificacao not null,
  locacao_id uuid references public.locacoes (id),
  parcela_id uuid references public.parcelas (id),
  comentario_id uuid references public.comentarios (id),
  usuario_solicitante_id uuid references public.usuarios (id) on delete cascade,
  lida boolean not null default false,
  lida_em timestamptz,
  criado_em timestamptz not null default now()
);

create table public.versoes_app (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  data_publicacao date not null,
  itens text[] not null default '{}'
);

-- Log somente leitura: sem chaves estrangeiras, para o histórico nunca se perder.
create table public.log_eventos (
  id bigint generated always as identity primary key,
  tabela text not null,
  registro_id text,
  locacao_id uuid,
  usuario_id uuid,
  acao text not null,
  campo text,
  valor_anterior text,
  valor_novo text,
  data_hora timestamptz not null default now()
);

-- Índices
create index locacoes_inicio_idx on public.locacoes (inicio);
create index locacoes_responsavel_idx on public.locacoes (responsavel_id);
create index parcelas_locacao_idx on public.parcelas (locacao_id);
create index parcelas_vencimento_idx on public.parcelas (vencimento) where not paga and not encerrada and not excluido;
create index devolucoes_locacao_idx on public.devolucoes (locacao_id);
create index anexos_locacao_idx on public.anexos (locacao_id);
create index comentarios_locacao_idx on public.comentarios (locacao_id);
create index notificacoes_usuario_idx on public.notificacoes (usuario_id, lida, criado_em desc);
create index log_locacao_idx on public.log_eventos (locacao_id, data_hora desc);
create index log_data_idx on public.log_eventos (data_hora desc);
create index log_tabela_registro_idx on public.log_eventos (tabela, registro_id);

-- ---------------------------------------------------------------------
-- 3. Funções de permissão
-- ---------------------------------------------------------------------
create or replace function public.usuario_ativo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and status_acesso = 'ativo')
$$;

create or replace function public.tem_permissao(p_modulo text, p_acao text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.usuarios u
    join public.permissoes p on p.perfil_id = u.perfil_id
    where u.id = auth.uid()
      and u.status_acesso = 'ativo'
      and p.modulo = p_modulo
      and case p_acao
            when 'visualizar' then p.visualizar
            when 'incluir' then p.incluir
            when 'alterar' then p.alterar
            when 'excluir' then p.excluir
            else false
          end
  )
$$;

create or replace function public.tem_acao(p_acao text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.usuarios u
    join public.perfil_acoes a on a.perfil_id = u.perfil_id
    where u.id = auth.uid() and u.status_acesso = 'ativo' and a.acao = p_acao
  )
$$;

-- Liga e desliga ações internas do banco (cascata, recálculo), que dispensam as travas de permissão.
create or replace function public.em_operacao_interna()
returns boolean language sql stable as $$
  select coalesce(current_setting('app.operacao_interna', true), '') = 'on'
$$;

-- ---------------------------------------------------------------------
-- 4. Gatilhos genéricos
-- ---------------------------------------------------------------------

-- Carimba criado/alterado por e em.
create or replace function public.tg_carimbar()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if to_jsonb(new) ? 'criado_por' then
      new := jsonb_populate_record(new, jsonb_build_object('criado_por', coalesce(auth.uid()::text, to_jsonb(new) ->> 'criado_por'), 'criado_em', now()));
    end if;
  else
    if to_jsonb(new) ? 'alterado_por' then
      new := jsonb_populate_record(new, jsonb_build_object('alterado_por', coalesce(auth.uid()::text, to_jsonb(new) ->> 'alterado_por'), 'alterado_em', now()));
    end if;
  end if;
  return new;
end $$;

-- Exclusão lógica: confere permissão, carimba quem excluiu e bloqueia exclusão física pelo app.
create or replace function public.tg_exclusao_logica()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_modulo text := tg_argv[0];
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null then
      raise exception 'A exclusão física não é permitida. Marque o registro como excluído.' using errcode = '42501';
    end if;
    return old;
  end if;

  if new.excluido is distinct from old.excluido then
    if auth.uid() is not null and not public.em_operacao_interna() then
      if new.excluido and not public.tem_permissao(v_modulo, 'excluir') then
        raise exception 'Seu perfil não pode excluir este registro.' using errcode = '42501';
      end if;
      if not new.excluido and not public.tem_acao('restaurar_lixeira') then
        raise exception 'Só quem tem acesso à lixeira pode restaurar.' using errcode = '42501';
      end if;
    end if;
    if new.excluido then
      new.excluido_por := coalesce(auth.uid(), new.excluido_por);
      new.excluido_em := now();
    else
      new.excluido_por := null;
      new.excluido_em := null;
    end if;
  end if;
  return new;
end $$;

-- Log de eventos: grava criação, exclusão, restauração e cada campo alterado (valor anterior e novo).
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

-- O log nunca é alterado nem apagado, nem pelo administrador.
create or replace function public.tg_log_imutavel()
returns trigger language plpgsql as $$
begin
  raise exception 'O log de eventos é somente leitura.' using errcode = '42501';
end $$;

create trigger log_eventos_imutavel before update or delete on public.log_eventos
  for each row execute function public.tg_log_imutavel();

-- ---------------------------------------------------------------------
-- 5. Regras de negócio
-- ---------------------------------------------------------------------

-- Status de pagamento calculado a partir das parcelas e da devolução.
create or replace function public.recalcular_status_pagamento(p_locacao uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_status public.status_compromisso;
  v_pago numeric;
  v_devolvido numeric;
  v_qtd_dev integer;
  v_novo public.status_pagamento;
begin
  select valor_total, status_compromisso into v_total, v_status from public.locacoes where id = p_locacao;
  if not found then return; end if;

  select coalesce(sum(valor), 0) into v_pago from public.parcelas where locacao_id = p_locacao and paga and not excluido;
  select coalesce(sum(valor_devolvido), 0), count(*) into v_devolvido, v_qtd_dev from public.devolucoes where locacao_id = p_locacao;

  if v_status = 'cancelado' and v_qtd_dev > 0 then
    v_novo := case when v_devolvido >= v_pago then 'devolvido' else 'devolvido_parcial' end;
  elsif v_pago <= 0 then
    v_novo := 'pendente';
  elsif v_pago >= v_total then
    v_novo := 'pago';
  else
    v_novo := 'parcial';
  end if;

  perform set_config('app.operacao_interna', 'on', true);
  update public.locacoes set status_pagamento = v_novo where id = p_locacao and status_pagamento is distinct from v_novo;
  perform set_config('app.operacao_interna', 'off', true);
end $$;

-- Reservas: ações sensíveis e proteção do status de pagamento.
create or replace function public.tg_locacoes_regras()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.em_operacao_interna() then
    if new.status_compromisso = 'reservado' and (tg_op = 'INSERT' or old.status_compromisso <> 'reservado')
       and not public.tem_acao('confirmar_reserva') then
      raise exception 'Seu perfil não pode confirmar reservas.' using errcode = '42501';
    end if;
    if new.status_compromisso = 'cancelado' and (tg_op = 'INSERT' or old.status_compromisso <> 'cancelado')
       and not public.tem_acao('cancelar_reserva') then
      raise exception 'Seu perfil não pode cancelar reservas.' using errcode = '42501';
    end if;
  end if;

  if not public.em_operacao_interna() then
    if tg_op = 'INSERT' then
      new.status_pagamento := 'pendente';
    else
      new.status_pagamento := old.status_pagamento;
    end if;
  end if;
  return new;
end $$;

-- Depois de mudar uma reserva: cascata da exclusão, parcelas no cancelamento e recálculo do pagamento.
create or replace function public.tg_locacoes_depois()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.operacao_interna', 'on', true);

  -- Excluir oculta junto parcelas, anexos e comentários; restaurar traz de volta os que saíram junto.
  if new.excluido and not old.excluido then
    update public.parcelas set excluido = true where locacao_id = new.id and not excluido;
    update public.anexos set excluido = true where locacao_id = new.id and not excluido;
    update public.comentarios set excluido = true where locacao_id = new.id and not excluido;
  elsif old.excluido and not new.excluido then
    update public.parcelas set excluido = false where locacao_id = new.id and excluido and excluido_em = old.excluido_em;
    update public.anexos set excluido = false where locacao_id = new.id and excluido and excluido_em = old.excluido_em;
    update public.comentarios set excluido = false where locacao_id = new.id and excluido and excluido_em = old.excluido_em;
  end if;

  -- Cancelar encerra as parcelas em aberto; sair do cancelamento reabre.
  if new.status_compromisso = 'cancelado' and old.status_compromisso <> 'cancelado' then
    update public.parcelas set encerrada = true where locacao_id = new.id and not paga and not encerrada;
  elsif old.status_compromisso = 'cancelado' and new.status_compromisso <> 'cancelado' then
    update public.parcelas set encerrada = false where locacao_id = new.id and encerrada;
  end if;

  perform set_config('app.operacao_interna', 'off', true);

  if new.valor_total is distinct from old.valor_total or new.status_compromisso is distinct from old.status_compromisso then
    perform public.recalcular_status_pagamento(new.id);
  end if;
  return new;
end $$;

-- Parcelas: marcar como paga é ação sensível.
create or replace function public.tg_parcelas_regras()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.em_operacao_interna()
     and new.paga is distinct from (case when tg_op = 'INSERT' then false else old.paga end)
     and not public.tem_acao('marcar_pago') then
    raise exception 'Seu perfil não pode marcar parcelas como pagas.' using errcode = '42501';
  end if;
  if new.paga and new.pago_em is null then
    new.pago_em := (now() at time zone 'America/Sao_Paulo')::date;
  elsif not new.paga then
    new.pago_em := null;
  end if;
  return new;
end $$;

create or replace function public.tg_recalcular_pagamento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recalcular_status_pagamento(coalesce(new.locacao_id, old.locacao_id));
  return coalesce(new, old);
end $$;

-- Devoluções: ação sensível; calcula o valor retido.
create or replace function public.tg_devolucoes_regras()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_pago numeric;
begin
  if auth.uid() is not null and not public.tem_acao('registrar_devolucao') then
    raise exception 'Seu perfil não pode registrar devoluções.' using errcode = '42501';
  end if;
  select coalesce(sum(valor), 0) into v_pago from public.parcelas where locacao_id = new.locacao_id and paga and not excluido;
  if new.valor_devolvido > v_pago then
    raise exception 'O valor devolvido (%) é maior que o valor recebido (%).', new.valor_devolvido, v_pago;
  end if;
  new.valor_retido := v_pago - new.valor_devolvido;
  if tg_op = 'INSERT' then
    new.registrado_por := coalesce(auth.uid(), new.registrado_por);
    new.registrado_em := now();
  end if;
  return new;
end $$;

-- Anexos: carimba quem enviou.
create or replace function public.tg_anexos_regras()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.enviado_por := coalesce(auth.uid(), new.enviado_por);
    new.enviado_em := now();
  end if;
  return new;
end $$;

-- Comentários: só o autor edita o texto.
create or replace function public.tg_comentarios_regras()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.autor_id := coalesce(auth.uid(), new.autor_id);
    new.criado_em := now();
    new.editado_em := null;
  elsif new.texto is distinct from old.texto then
    if auth.uid() is not null and old.autor_id <> auth.uid() then
      raise exception 'Só o autor pode editar o comentário.' using errcode = '42501';
    end if;
    new.editado_em := now();
  end if;
  if tg_op = 'UPDATE' then
    new.autor_id := old.autor_id;
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
    join public.permissoes p on p.perfil_id = u.perfil_id and p.modulo = 'reservas' and p.visualizar
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

-- Notificações: o dono só pode marcar como lida.
create or replace function public.tg_notificacoes_regras()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    if (to_jsonb(new) - 'lida' - 'lida_em') is distinct from (to_jsonb(old) - 'lida' - 'lida_em') then
      raise exception 'Só é possível marcar a notificação como lida.' using errcode = '42501';
    end if;
  end if;
  new.lida_em := case when new.lida then coalesce(new.lida_em, now()) else null end;
  return new;
end $$;

-- Usuários: só o administrador mexe em acesso e perfil; ninguém altera o próprio acesso.
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

-- Ao decidir um pedido, os alertas de pedido de acesso dessa pessoa saem como lidos.
create or replace function public.tg_usuarios_depois()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status_acesso is distinct from old.status_acesso and old.status_acesso in ('pendente', 'recusado') then
    update public.notificacoes set lida = true
    where tipo = 'pedido_acesso' and usuario_solicitante_id = new.id and not lida;
  end if;
  return new;
end $$;

-- Pedido de acesso: avisa no sino quem pode administrar usuários.
create or replace function public.notificar_pedido_acesso(p_usuario uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.notificacoes (usuario_id, tipo, usuario_solicitante_id)
  select u.id, 'pedido_acesso', p_usuario
  from public.usuarios u
  join public.perfil_acoes a on a.perfil_id = u.perfil_id and a.acao = 'administrar_usuarios'
  where u.status_acesso = 'ativo' and u.id <> p_usuario
$$;

-- Primeiro login com o Google: cria o usuário pendente. O e-mail do primeiro administrador entra ativo.
create or replace function public.tg_novo_usuario_auth()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_admin_email text;
  v_eh_admin boolean;
  v_perfil_admin uuid;
begin
  select admin_email into v_admin_email from public.config_privada where id = 1;
  v_eh_admin := v_admin_email is not null and lower(new.email) = lower(trim(v_admin_email));
  select id into v_perfil_admin from public.perfis where nome = 'Administrador';

  insert into public.usuarios (id, nome, email, foto_google, status_acesso, perfil_id, decidido_em)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    case when v_eh_admin then 'ativo' else 'pendente' end::public.status_acesso,
    case when v_eh_admin then v_perfil_admin end,
    case when v_eh_admin then now() end
  )
  on conflict (id) do nothing;

  if not v_eh_admin then
    perform public.notificar_pedido_acesso(new.id);
  end if;
  return new;
end $$;

create trigger ao_criar_usuario_auth after insert on auth.users
  for each row execute function public.tg_novo_usuario_auth();

-- Quem foi recusado e tenta entrar de novo gera um novo alerta (um por vez, até alguém ler).
create or replace function public.registrar_tentativa_acesso()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status public.status_acesso;
begin
  select status_acesso into v_status from public.usuarios where id = auth.uid();
  if v_status is distinct from 'recusado' then return; end if;
  if exists (select 1 from public.notificacoes where tipo = 'pedido_acesso' and usuario_solicitante_id = auth.uid() and not lida) then
    return;
  end if;
  perform public.notificar_pedido_acesso(auth.uid());
  insert into public.log_eventos (tabela, registro_id, usuario_id, acao, campo, valor_novo)
  values ('usuarios', auth.uid()::text, auth.uid(), 'pediu acesso novamente', 'status_acesso', 'recusado');
end $$;

-- Excluir e restaurar passam por estas funções. Assim o registro some do app para todos,
-- continua no banco e a lixeira (restaurar) fica só com quem tem essa permissão.
create or replace function public.modulo_da_tabela(p_tabela text)
returns text language sql immutable as $$
  select case p_tabela
    when 'locacoes' then 'reservas'
    when 'parcelas' then 'pagamentos'
    when 'anexos' then 'anexos'
    when 'comentarios' then 'comentarios'
    when 'pessoas' then 'pessoas'
  end
$$;

create or replace function public.excluir_registro(p_tabela text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_modulo text := public.modulo_da_tabela(p_tabela);
  v_qtd integer;
begin
  if v_modulo is null then raise exception 'Tipo de registro inválido: %', p_tabela; end if;
  if not public.tem_permissao(v_modulo, 'excluir') then
    raise exception 'Seu perfil não pode excluir este registro.' using errcode = '42501';
  end if;
  execute format('update public.%I set excluido = true where id = $1 and not excluido', p_tabela) using p_id;
  get diagnostics v_qtd = row_count;
  if v_qtd = 0 then raise exception 'Registro não encontrado ou já excluído.'; end if;
end $$;

create or replace function public.restaurar_registro(p_tabela text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_modulo text := public.modulo_da_tabela(p_tabela);
  v_qtd integer;
begin
  if v_modulo is null then raise exception 'Tipo de registro inválido: %', p_tabela; end if;
  if not public.tem_acao('restaurar_lixeira') then
    raise exception 'Só quem tem acesso à lixeira pode restaurar.' using errcode = '42501';
  end if;
  execute format('update public.%I set excluido = false where id = $1 and excluido', p_tabela) using p_id;
  get diagnostics v_qtd = row_count;
  if v_qtd = 0 then raise exception 'Registro não encontrado na lixeira.'; end if;
end $$;

-- Alertas de vencimento: 3 dias antes e no dia seguinte ao vencimento sem pagamento.
-- Recebem: responsável da reserva, administradores e gestores. Rodada diária pelo pg_cron (migração 0002).
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
    join public.perfis pf on pf.id = u.perfil_id and pf.nome in ('Administrador', 'Gestor')
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

-- ---------------------------------------------------------------------
-- 6. Ligação dos gatilhos
-- ---------------------------------------------------------------------
create trigger carimbar before insert or update on public.pessoas for each row execute function public.tg_carimbar();
create trigger carimbar before insert or update on public.locacoes for each row execute function public.tg_carimbar();
create trigger carimbar before insert or update on public.parcelas for each row execute function public.tg_carimbar();
create trigger carimbar before update on public.devolucoes for each row execute function public.tg_carimbar();
create trigger carimbar before update on public.configuracoes for each row execute function public.tg_carimbar();

create trigger exclusao_logica before update or delete on public.pessoas for each row execute function public.tg_exclusao_logica('pessoas');
create trigger exclusao_logica before update or delete on public.locacoes for each row execute function public.tg_exclusao_logica('reservas');
create trigger exclusao_logica before update or delete on public.parcelas for each row execute function public.tg_exclusao_logica('pagamentos');
create trigger exclusao_logica before update or delete on public.anexos for each row execute function public.tg_exclusao_logica('anexos');
create trigger exclusao_logica before update or delete on public.comentarios for each row execute function public.tg_exclusao_logica('comentarios');

create trigger regras before insert or update on public.locacoes for each row execute function public.tg_locacoes_regras();
create trigger depois after update on public.locacoes for each row execute function public.tg_locacoes_depois();
create trigger regras before insert or update on public.parcelas for each row execute function public.tg_parcelas_regras();
create trigger recalcular after insert or update or delete on public.parcelas for each row execute function public.tg_recalcular_pagamento();
create trigger regras before insert or update on public.devolucoes for each row execute function public.tg_devolucoes_regras();
create trigger recalcular after insert or update or delete on public.devolucoes for each row execute function public.tg_recalcular_pagamento();
create trigger regras before insert or update on public.anexos for each row execute function public.tg_anexos_regras();
create trigger regras before insert or update on public.comentarios for each row execute function public.tg_comentarios_regras();
create trigger mencoes after insert on public.comentario_mencoes for each row execute function public.tg_mencoes();
create trigger regras before update on public.notificacoes for each row execute function public.tg_notificacoes_regras();
create trigger regras before update on public.usuarios for each row execute function public.tg_usuarios_regras();
create trigger depois after update on public.usuarios for each row execute function public.tg_usuarios_depois();

create trigger log after insert or update or delete on public.locacoes for each row execute function public.tg_log();
create trigger log after insert or update or delete on public.parcelas for each row execute function public.tg_log();
create trigger log after insert or update or delete on public.devolucoes for each row execute function public.tg_log();
create trigger log after insert or update or delete on public.anexos for each row execute function public.tg_log();
create trigger log after insert or update or delete on public.comentarios for each row execute function public.tg_log();
create trigger log after insert on public.comentario_mencoes for each row execute function public.tg_log();
create trigger log after insert or update or delete on public.pessoas for each row execute function public.tg_log();
create trigger log after insert or update or delete on public.usuarios for each row execute function public.tg_log();
create trigger log after update on public.configuracoes for each row execute function public.tg_log();
create trigger log after insert or update or delete on public.formas_pagamento for each row execute function public.tg_log();
create trigger log after insert or update or delete on public.perfis for each row execute function public.tg_log();
create trigger log after insert or update or delete on public.permissoes for each row execute function public.tg_log();
create trigger log after insert or delete on public.perfil_acoes for each row execute function public.tg_log();

-- ---------------------------------------------------------------------
-- 7. Segurança por linha (RLS)
-- ---------------------------------------------------------------------
alter table public.config_privada enable row level security;
alter table public.perfis enable row level security;
alter table public.permissoes enable row level security;
alter table public.perfil_acoes enable row level security;
alter table public.usuarios enable row level security;
alter table public.configuracoes enable row level security;
alter table public.formas_pagamento enable row level security;
alter table public.espacos enable row level security;
alter table public.pessoas enable row level security;
alter table public.locacoes enable row level security;
alter table public.parcelas enable row level security;
alter table public.devolucoes enable row level security;
alter table public.anexos enable row level security;
alter table public.comentarios enable row level security;
alter table public.comentario_mencoes enable row level security;
alter table public.notificacoes enable row level security;
alter table public.versoes_app enable row level security;
alter table public.log_eventos enable row level security;

-- config_privada: sem políticas (ninguém do app lê).

-- Nome e logo aparecem na tela de login, antes de entrar.
create policy "configuracoes: todos leem" on public.configuracoes for select using (true);
create policy "configuracoes: alterar" on public.configuracoes for update using (public.tem_permissao('configuracoes', 'alterar')) with check (public.tem_permissao('configuracoes', 'alterar'));

create policy "perfis: ativos leem" on public.perfis for select using (public.usuario_ativo());
create policy "perfis: admin gerencia" on public.perfis for all using (public.tem_acao('administrar_usuarios')) with check (public.tem_acao('administrar_usuarios'));
create policy "permissoes: ativos leem" on public.permissoes for select using (public.usuario_ativo());
create policy "permissoes: admin gerencia" on public.permissoes for all using (public.tem_acao('administrar_usuarios')) with check (public.tem_acao('administrar_usuarios'));
create policy "perfil_acoes: ativos leem" on public.perfil_acoes for select using (public.usuario_ativo());
create policy "perfil_acoes: admin gerencia" on public.perfil_acoes for all using (public.tem_acao('administrar_usuarios')) with check (public.tem_acao('administrar_usuarios'));

-- Cada um lê o próprio cadastro (tela de espera); usuários ativos leem todos (responsável, menções, log).
create policy "usuarios: ler" on public.usuarios for select using (id = auth.uid() or public.usuario_ativo());
create policy "usuarios: alterar" on public.usuarios for update using (id = auth.uid() or public.tem_acao('administrar_usuarios'))
  with check (id = auth.uid() or public.tem_acao('administrar_usuarios'));

create policy "formas_pagamento: ativos leem" on public.formas_pagamento for select using (public.usuario_ativo());
create policy "formas_pagamento: incluir" on public.formas_pagamento for insert with check (public.tem_permissao('configuracoes', 'alterar'));
create policy "formas_pagamento: alterar" on public.formas_pagamento for update using (public.tem_permissao('configuracoes', 'alterar'));

create policy "espacos: ativos leem" on public.espacos for select using (public.usuario_ativo());

create policy "pessoas: ler" on public.pessoas for select
  using ((public.tem_permissao('pessoas', 'visualizar') or public.tem_permissao('reservas', 'visualizar')) and (not excluido or public.tem_acao('restaurar_lixeira')));
create policy "pessoas: incluir" on public.pessoas for insert with check (public.tem_permissao('pessoas', 'incluir'));
create policy "pessoas: alterar" on public.pessoas for update using (public.tem_permissao('pessoas', 'alterar') or public.tem_acao('restaurar_lixeira'));

create policy "locacoes: ler" on public.locacoes for select
  using (public.tem_permissao('reservas', 'visualizar') and (not excluido or public.tem_acao('restaurar_lixeira')));
create policy "locacoes: incluir" on public.locacoes for insert with check (public.tem_permissao('reservas', 'incluir'));
create policy "locacoes: alterar" on public.locacoes for update using (public.tem_permissao('reservas', 'alterar') or public.tem_acao('restaurar_lixeira'));

create policy "parcelas: ler" on public.parcelas for select
  using (public.tem_permissao('pagamentos', 'visualizar') and (not excluido or public.tem_acao('restaurar_lixeira')));
create policy "parcelas: incluir" on public.parcelas for insert with check (public.tem_permissao('pagamentos', 'incluir'));
create policy "parcelas: alterar" on public.parcelas for update using (public.tem_permissao('pagamentos', 'alterar') or public.tem_acao('restaurar_lixeira'));

create policy "devolucoes: ler" on public.devolucoes for select using (public.tem_permissao('pagamentos', 'visualizar'));
create policy "devolucoes: incluir" on public.devolucoes for insert with check (public.tem_acao('registrar_devolucao'));
create policy "devolucoes: alterar" on public.devolucoes for update using (public.tem_acao('registrar_devolucao'));

create policy "anexos: ler" on public.anexos for select
  using (public.tem_permissao('anexos', 'visualizar') and (not excluido or public.tem_acao('restaurar_lixeira')));
create policy "anexos: incluir" on public.anexos for insert with check (public.tem_permissao('anexos', 'incluir'));
create policy "anexos: alterar" on public.anexos for update using (public.tem_permissao('anexos', 'alterar') or public.tem_permissao('anexos', 'excluir') or public.tem_acao('restaurar_lixeira'));

create policy "comentarios: ler" on public.comentarios for select
  using (public.tem_permissao('comentarios', 'visualizar') and (not excluido or public.tem_acao('restaurar_lixeira')));
create policy "comentarios: incluir" on public.comentarios for insert with check (public.tem_permissao('comentarios', 'incluir') and autor_id = auth.uid());
create policy "comentarios: alterar" on public.comentarios for update
  using ((autor_id = auth.uid() and public.tem_permissao('comentarios', 'alterar')) or public.tem_permissao('comentarios', 'excluir') or public.tem_acao('restaurar_lixeira'));

create policy "mencoes: ler" on public.comentario_mencoes for select using (public.tem_permissao('comentarios', 'visualizar'));
create policy "mencoes: incluir" on public.comentario_mencoes for insert with check (public.tem_permissao('comentarios', 'incluir'));

create policy "notificacoes: dono le" on public.notificacoes for select using (usuario_id = auth.uid());
create policy "notificacoes: dono marca lida" on public.notificacoes for update using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

create policy "versoes: ativos leem" on public.versoes_app for select using (public.usuario_ativo());

create policy "log: ler" on public.log_eventos for select using (
  public.tem_acao('ver_log_geral')
  or (locacao_id is not null and public.tem_permissao('reservas', 'visualizar'))
  or (tabela = 'usuarios' and public.tem_acao('administrar_usuarios'))
);

-- Ninguém do app apaga fisicamente: exclusão é lógica.
revoke delete on public.pessoas, public.locacoes, public.parcelas, public.devolucoes, public.anexos,
  public.comentarios, public.comentario_mencoes, public.notificacoes, public.usuarios, public.log_eventos,
  public.configuracoes, public.formas_pagamento, public.espacos, public.versoes_app from anon, authenticated;
revoke insert, update on public.log_eventos from anon, authenticated;
revoke all on public.config_privada from anon, authenticated;

grant execute on function public.registrar_tentativa_acesso() to authenticated;
grant execute on function public.excluir_registro(text, uuid) to authenticated;
grant execute on function public.restaurar_registro(text, uuid) to authenticated;
revoke execute on function public.excluir_registro(text, uuid) from anon;
revoke execute on function public.restaurar_registro(text, uuid) from anon;
revoke execute on function public.gerar_alertas_vencimento() from public, anon, authenticated;
revoke execute on function public.notificar_pedido_acesso(uuid) from public, anon, authenticated;
revoke execute on function public.recalcular_status_pagamento(uuid) from public, anon, authenticated;

-- Sino em tempo real.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notificacoes;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Armazenamento de arquivos
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('anexos', 'anexos', false, 20971520, array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('avatares', 'avatares', true, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
  ('marca', 'marca', true, 2097152, array['image/png', 'image/svg+xml', 'image/webp', 'image/x-icon'])
on conflict (id) do nothing;

-- Anexos: privados, lidos com link temporário por quem tem permissão.
create policy "anexos: ler arquivo" on storage.objects for select
  using (bucket_id = 'anexos' and public.tem_permissao('anexos', 'visualizar'));
create policy "anexos: enviar arquivo" on storage.objects for insert
  with check (bucket_id = 'anexos' and public.tem_permissao('anexos', 'incluir'));

-- Avatares: cada usuário grava na própria pasta (avatares/<id do usuário>/...).
create policy "avatares: enviar" on storage.objects for insert
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatares: trocar" on storage.objects for update
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatares: remover" on storage.objects for delete
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);

-- Marca (logo e ícone): quem pode alterar as configurações.
create policy "marca: enviar" on storage.objects for insert
  with check (bucket_id = 'marca' and public.tem_permissao('configuracoes', 'alterar'));
create policy "marca: trocar" on storage.objects for update
  using (bucket_id = 'marca' and public.tem_permissao('configuracoes', 'alterar'));
create policy "marca: remover" on storage.objects for delete
  using (bucket_id = 'marca' and public.tem_permissao('configuracoes', 'alterar'));

-- ---------------------------------------------------------------------
-- 9. Dados iniciais
-- ---------------------------------------------------------------------
insert into public.espacos (nome) values ('A casa');

insert into public.formas_pagamento (nome, ordem) values
  ('Pix', 1), ('Dinheiro', 2), ('Cartão de crédito', 3), ('Cartão de débito', 4), ('Transferência', 5), ('Boleto', 6);

insert into public.perfis (nome, descricao) values
  ('Administrador', 'Faz tudo, inclusive aprovar usuários e mexer nas configurações.'),
  ('Gestor', 'Opera reservas, pagamentos e anexos no dia a dia; não administra usuários.'),
  ('Operador', 'Cadastra e acompanha reservas até a pré-reserva.'),
  ('Consulta', 'Só vê a agenda e a lista.');

-- Matriz de permissões (plano v1.8, item 8). Colunas: visualizar, incluir, alterar, excluir.
insert into public.permissoes (perfil_id, modulo, visualizar, incluir, alterar, excluir)
select p.id, m.modulo, m.v, m.i, m.a, m.e
from public.perfis p
join (values
  ('Administrador', 'reservas', true, true, true, true),
  ('Administrador', 'pagamentos', true, true, true, true),
  ('Administrador', 'anexos', true, true, true, true),
  ('Administrador', 'comentarios', true, true, true, true),
  ('Administrador', 'pessoas', true, true, true, true),
  ('Administrador', 'usuarios', true, true, true, true),
  ('Administrador', 'logs', true, true, true, true),
  ('Administrador', 'configuracoes', true, true, true, true),
  ('Gestor', 'reservas', true, true, true, true),
  ('Gestor', 'pagamentos', true, true, true, false),
  ('Gestor', 'anexos', true, true, true, true),
  ('Gestor', 'comentarios', true, true, true, true),
  ('Gestor', 'pessoas', true, true, true, false),
  ('Gestor', 'usuarios', true, false, false, false),
  ('Gestor', 'logs', true, false, false, false),
  ('Gestor', 'configuracoes', false, false, false, false),
  ('Operador', 'reservas', true, true, true, false),
  ('Operador', 'pagamentos', true, false, false, false),
  ('Operador', 'anexos', true, true, false, false),
  ('Operador', 'comentarios', true, true, false, false),
  ('Operador', 'pessoas', true, true, true, false),
  ('Operador', 'usuarios', false, false, false, false),
  ('Operador', 'logs', false, false, false, false),
  ('Operador', 'configuracoes', false, false, false, false),
  ('Consulta', 'reservas', true, false, false, false),
  ('Consulta', 'pagamentos', false, false, false, false),
  ('Consulta', 'anexos', false, false, false, false),
  ('Consulta', 'comentarios', false, false, false, false),
  ('Consulta', 'pessoas', false, false, false, false),
  ('Consulta', 'usuarios', false, false, false, false),
  ('Consulta', 'logs', false, false, false, false),
  ('Consulta', 'configuracoes', false, false, false, false)
) as m (perfil, modulo, v, i, a, e) on m.perfil = p.nome;

insert into public.perfil_acoes (perfil_id, acao)
select p.id, a.acao
from public.perfis p
join (values
  ('Administrador', 'marcar_pago'), ('Administrador', 'registrar_devolucao'), ('Administrador', 'confirmar_reserva'),
  ('Administrador', 'cancelar_reserva'), ('Administrador', 'ver_log_geral'), ('Administrador', 'administrar_usuarios'),
  ('Administrador', 'restaurar_lixeira'),
  ('Gestor', 'marcar_pago'), ('Gestor', 'registrar_devolucao'), ('Gestor', 'confirmar_reserva'),
  ('Gestor', 'cancelar_reserva'), ('Gestor', 'ver_log_geral')
) as a (perfil, acao) on a.perfil = p.nome;

insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v0.1.0', '2026-11-12', array[
    'Login com Google e liberação de acesso pelo administrador',
    'Banco de dados completo: reservas, pagamentos, anexos, comentários, log e permissões',
    'Menu com nome e logo do app, versão e configurações',
    'Tema claro e escuro'
  ]);
