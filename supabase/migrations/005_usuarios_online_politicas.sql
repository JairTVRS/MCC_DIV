-- =====================================================================
-- v0.2.1 - Usuários online: políticas do canal privado refeitas
-- Rode depois da 004: SQL Editor > New query > colar > Run. Pode rodar de novo sem problema.
--
-- Ao entrar num canal privado, o Realtime confere a leitura de mensagens (broadcast)
-- além da presença. A 004 liberava só a presença, e a entrada no canal "online" era recusada.
-- =====================================================================
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'Tabela realtime.messages não encontrada: nada a fazer.';
    return;
  end if;

  execute 'drop policy if exists "online: ativos veem" on realtime.messages';
  execute 'drop policy if exists "online: ativos aparecem" on realtime.messages';

  -- Só usuário ativo entra no canal "online", vê quem está nele e aparece para os outros.
  execute $p$create policy "online: ativos veem" on realtime.messages for select to authenticated
    using ((select realtime.topic()) = 'online'
           and realtime.messages.extension in ('broadcast', 'presence')
           and public.usuario_ativo())$p$;
  execute $p$create policy "online: ativos aparecem" on realtime.messages for insert to authenticated
    with check ((select realtime.topic()) = 'online'
                and realtime.messages.extension in ('broadcast', 'presence')
                and public.usuario_ativo())$p$;
end $$;

insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v0.2.1', '2026-11-13', array[
    'Correção: o contador de usuários online ao lado da versão volta a aparecer'
  ])
on conflict (numero) do nothing;

-- Confere: o resultado deve listar as duas políticas ("online: ativos veem" e "online: ativos aparecem").
select policyname, cmd from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname like 'online:%';
