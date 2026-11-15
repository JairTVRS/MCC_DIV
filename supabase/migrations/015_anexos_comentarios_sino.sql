-- =====================================================================
-- v0.8.0 - Anexos, comentários com menções e sino de notificações (etapa 8)
-- Rode depois da 014: SQL Editor > New query > colar > Run.
--
-- * Categorias de anexo em cadastro (Configurações), já com Contrato, Comprovante,
--   Documento do locatário, Foto e Outro. "Comprovante" é do sistema (usada pelos pagamentos):
--   não pode ser renomeada nem desativada.
-- * Anexo só com categoria cadastrada; trocar a categoria exige Anexos > Alterar.
-- * contadores_reservas(): quantos anexos e comentários cada reserva tem (para o card da agenda).
-- * minhas_notificacoes(): avisos do sino já com título e detalhe prontos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Categorias de anexo
-- ---------------------------------------------------------------------
create table public.categorias_anexo (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) between 1 and 40),
  ativo boolean not null default true,
  ordem integer not null default 0,
  sistema boolean not null default false
);
create unique index categorias_anexo_nome_unico on public.categorias_anexo (lower(trim(nome)));

create or replace function public.tg_categorias_anexo_regras()
returns trigger language plpgsql as $$
begin
  new.nome := trim(new.nome);
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.sistema := false;
    end if;
  elsif old.sistema and (new.nome is distinct from old.nome or not new.ativo or not new.sistema) then
    raise exception 'A categoria "%" é usada pelos pagamentos: não pode ser renomeada nem desativada.', old.nome;
  elsif new.sistema and not old.sistema and auth.uid() is not null then
    raise exception 'Categoria inválida.';
  end if;
  return new;
end $$;

create trigger regras before insert or update on public.categorias_anexo
  for each row execute function public.tg_categorias_anexo_regras();
create trigger log after insert or update or delete on public.categorias_anexo
  for each row execute function public.tg_log();

insert into public.categorias_anexo (nome, ordem, sistema) values
  ('Contrato', 1, false),
  ('Comprovante', 2, true),
  ('Documento do locatário', 3, false),
  ('Foto', 4, false),
  ('Outro', 5, false);

alter table public.categorias_anexo enable row level security;
create policy "categorias_anexo: ativos leem" on public.categorias_anexo for select using (public.usuario_ativo());
create policy "categorias_anexo: incluir" on public.categorias_anexo for insert with check (public.tem_funcao('configuracoes.categorias_anexo'));
create policy "categorias_anexo: alterar" on public.categorias_anexo for update using (public.tem_funcao('configuracoes.categorias_anexo'));
revoke delete on public.categorias_anexo from anon, authenticated;

-- Árvore: Configurações > Categorias de anexo (para quem já cuidava das formas de pagamento).
update public.funcoes set ordem = 96 where codigo = 'configuracoes.lixeira';
insert into public.funcoes (codigo, pai, tipo, rotulo, descricao, ordem)
values ('configuracoes.categorias_anexo', 'configuracoes', 'funcao', 'Categorias de anexo', 'Cadastro das categorias dos anexos da reserva.', 95);
insert into public.grupo_funcoes (perfil_id, funcao)
select perfil_id, 'configuracoes.categorias_anexo' from public.grupo_funcoes where funcao = 'configuracoes.formas_pagamento'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. Anexos: categoria cadastrada; trocar a categoria exige Anexos > Alterar
-- ---------------------------------------------------------------------
alter table public.anexos alter column categoria set default 'Outro';
update public.anexos set categoria = 'Outro'
where categoria not in (select nome from public.categorias_anexo);

create or replace function public.tg_anexos_regras()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.enviado_por := coalesce(auth.uid(), new.enviado_por);
    new.enviado_em := now();
  end if;
  if tg_op = 'INSERT' or new.categoria is distinct from old.categoria then
    if not exists (select 1 from public.categorias_anexo where nome = new.categoria and ativo) then
      raise exception 'Categoria de anexo inválida: %.', new.categoria;
    end if;
    if tg_op = 'UPDATE' and auth.uid() is not null and not public.em_operacao_interna()
       and not public.tem_permissao('anexos', 'alterar') then
      raise exception 'Seu grupo não pode trocar a categoria do anexo.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3. Contadores do card: anexos e comentários por reserva (respeita as permissões de quem vê)
-- ---------------------------------------------------------------------
create or replace function public.contadores_reservas()
returns table (locacao_id uuid, anexos bigint, comentarios bigint)
language sql stable security invoker set search_path = public as $$
  select x.locacao_id, sum(x.a)::bigint, sum(x.c)::bigint
  from (
    select a.locacao_id, 1 as a, 0 as c from public.anexos a where not a.excluido
    union all
    select c.locacao_id, 0, 1 from public.comentarios c where not c.excluido
  ) x
  group by x.locacao_id
$$;
grant execute on function public.contadores_reservas() to authenticated;
revoke execute on function public.contadores_reservas() from public, anon;

-- ---------------------------------------------------------------------
-- 4. Sino: avisos do usuário logado com título e detalhe prontos
-- ---------------------------------------------------------------------
create or replace function public.minhas_notificacoes(p_limite integer default 40)
returns table (id uuid, tipo text, lida boolean, criado_em timestamptz, locacao_id uuid, comentario_id uuid, titulo text, detalhe text)
language sql stable security definer set search_path = public as $$
  select n.id, n.tipo::text, n.lida, n.criado_em, n.locacao_id, n.comentario_id,
         case n.tipo
           when 'mencao' then coalesce(us.nome, 'Alguém') || ' mencionou você'
           when 'pedido_acesso' then coalesce(us.nome, 'Alguém') || ' pediu acesso ao app'
           when 'vencimento' then 'Parcela vence em 3 dias'
           else 'Parcela vencida e não paga'
         end,
         case n.tipo
           when 'mencao' then 'Na ' || coalesce(public.texto_reserva(n.locacao_id), 'reserva')
                              || coalesce(': "' || left(c.texto, 90) || case when length(c.texto) > 90 then '…' else '' end || '"', '')
           when 'pedido_acesso' then us.email
           else coalesce(case when pa.tipo = 'entrada' then 'Entrada' else 'Parcela ' || pa.numero end
                         || ' · R$ ' || translate(to_char(pa.valor, 'FM999,999,990.00'), ',.', '.,')
                         || ' · vence ' || to_char(pa.vencimento, 'DD/MM/YYYY') || ' · ', '')
                || coalesce(public.texto_reserva(n.locacao_id), '')
         end
  from public.notificacoes n
  left join public.usuarios us on us.id = n.usuario_solicitante_id
  left join public.comentarios c on c.id = n.comentario_id
  left join public.parcelas pa on pa.id = n.parcela_id
  where n.usuario_id = auth.uid()
  order by n.criado_em desc
  limit greatest(1, least(p_limite, 200))
$$;
grant execute on function public.minhas_notificacoes(integer) to authenticated;
revoke execute on function public.minhas_notificacoes(integer) from public, anon;

-- ---------------------------------------------------------------------
-- 5. Novidades
-- ---------------------------------------------------------------------
insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v0.8.0', '2026-11-15', array[
    'Reserva > Anexos: enviar contrato, documentos e fotos (arrastando ou clicando), com categoria e miniatura',
    'Reserva > Comentários: linha do tempo com menções @ que avisam no sino',
    'Sino de notificações em tempo real: menções, pedidos de acesso e parcelas a vencer ou vencidas',
    'Card da agenda com o número de anexos e comentários',
    'Configurações: categorias de anexo'
  ])
on conflict (numero) do nothing;
